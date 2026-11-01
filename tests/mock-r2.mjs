// Minimal S3-compatible multipart mock for local tests only. It is NOT a
// production server and does not implement Cloudflare authentication.
import http from "node:http";
import crypto from "node:crypto";
import { Buffer } from "node:buffer";

const uploads = new Map();
const objects = new Map();
const port = Number(process.env.MOCK_R2_PORT || 9000);
const host = process.env.MOCK_R2_HOST || "127.0.0.1";

function xml(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/xml", "Access-Control-Allow-Origin": "*", "Access-Control-Expose-Headers": "ETag, Content-Length" });
  res.end(body);
}
function esc(value) { return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
async function body(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const key = decodeURIComponent(url.pathname.replace(/^\/[^/]+\//, ""));
  const uploadId = url.searchParams.get("uploadId");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,PUT,POST,DELETE,HEAD,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Access-Control-Expose-Headers", "ETag, Content-Length");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
  try {
    if (req.method === "POST" && url.searchParams.has("uploads")) {
      const id = crypto.randomUUID();
      uploads.set(id, { key, parts: new Map(), contentType: req.headers["content-type"] || "application/octet-stream", disposition: req.headers["content-disposition"] });
      return xml(res, 200, `<InitiateMultipartUploadResult><Bucket>test</Bucket><Key>${esc(key)}</Key><UploadId>${id}</UploadId></InitiateMultipartUploadResult>`);
    }
    if (req.method === "PUT" && uploadId) {
      const upload = uploads.get(uploadId);
      if (!upload) return xml(res, 404, "<Error><Code>NoSuchUpload</Code></Error>");
      const partNumber = Number(url.searchParams.get("partNumber"));
      const data = await body(req);
      const etag = `"${crypto.createHash("md5").update(data).digest("hex")}"`;
      upload.parts.set(partNumber, { data, etag });
      res.writeHead(200, { ETag: etag }); res.end(); return;
    }
    if (req.method === "GET" && uploadId) {
      const upload = uploads.get(uploadId);
      if (!upload) return xml(res, 404, "<Error><Code>NoSuchUpload</Code></Error>");
      const marker = Number(url.searchParams.get("PartNumberMarker") || 0);
      const parts = [...upload.parts.entries()].filter(([n]) => n > marker).sort((a, b) => a[0] - b[0]);
      return xml(res, 200, `<ListPartsResult><Bucket>test</Bucket><Key>${esc(upload.key)}</Key><UploadId>${uploadId}</UploadId><IsTruncated>false</IsTruncated>${parts.map(([n, p]) => `<Part><PartNumber>${n}</PartNumber><ETag>${esc(p.etag)}</ETag><Size>${p.data.length}</Size></Part>`).join("")}</ListPartsResult>`);
    }
    if (req.method === "POST" && uploadId) {
      const upload = uploads.get(uploadId);
      if (!upload) return xml(res, 404, "<Error><Code>NoSuchUpload</Code></Error>");
      const text = (await body(req)).toString();
      const numbers = [...text.matchAll(/<PartNumber>(\d+)<\/PartNumber>/g)].map((m) => Number(m[1]));
      const data = Buffer.concat(numbers.map((n) => upload.parts.get(n)?.data || Buffer.alloc(0)));
      objects.set(upload.key, { data, contentType: upload.contentType, disposition: upload.disposition });
      uploads.delete(uploadId);
      return xml(res, 200, `<CompleteMultipartUploadResult><Bucket>test</Bucket><Key>${esc(upload.key)}</Key><ETag>"complete"</ETag></CompleteMultipartUploadResult>`);
    }
    if (req.method === "DELETE" && uploadId) { uploads.delete(uploadId); res.writeHead(204); res.end(); return; }
    const object = objects.get(key);
    if (!object) return xml(res, 404, "<Error><Code>NoSuchKey</Code></Error>");
    if (req.method === "HEAD") {
      res.writeHead(200, { "Content-Length": object.data.length, "Content-Type": object.contentType, "Content-Disposition": object.disposition || "attachment" }); res.end(); return;
    }
    if (req.method === "GET") {
      const range = req.headers.range;
      let data = object.data; let status = 200;
      const headers = { "Content-Type": object.contentType, "Content-Disposition": url.searchParams.get("response-content-disposition") || object.disposition || "attachment", "Accept-Ranges": "bytes" };
      if (range) {
        const match = /bytes=(\d+)-(\d*)/.exec(range);
        if (match) { const start = Number(match[1]); const end = match[2] ? Number(match[2]) : data.length - 1; data = data.subarray(start, end + 1); status = 206; headers["Content-Range"] = `bytes ${start}-${end}/${object.data.length}`; }
      }
      headers["Content-Length"] = data.length;
      res.writeHead(status, headers); res.end(data); return;
    }
    res.writeHead(405); res.end();
  } catch (error) { console.error(error); xml(res, 500, "<Error><Code>InternalError</Code></Error>"); }
});
server.listen(port, host, () => console.log(`Mock R2 listening on http://${host}:${port}`));
process.on("SIGTERM", () => server.close(() => process.exit(0)));
