// Minimal S3-compatible multipart mock for local tests only. It is NOT a
// production server. It verifies presigned SigV4 query signatures so tests can
// catch method/expiry/tampering mistakes, but it does not implement full IAM.
import http from "node:http";
import crypto from "node:crypto";
import { Buffer } from "node:buffer";

const uploads = new Map();
const objects = new Map();
const port = Number(process.env.MOCK_R2_PORT || 9000);
const host = process.env.MOCK_R2_HOST || "127.0.0.1";
const bucketName = process.env.MOCK_R2_BUCKET_NAME || "test-bucket";
const accessKeyId = process.env.MOCK_R2_ACCESS_KEY_ID || "test-access-key";
const secretAccessKey = process.env.MOCK_R2_SECRET_ACCESS_KEY || "test-secret-key";

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
function hmac(key, value) { return crypto.createHmac("sha256", key).update(value).digest(); }
function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
function uriEncode(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}
function verifyPresign(req, url) {
  const q = url.searchParams;
  const signature = q.get("X-Amz-Signature");
  if (!signature) return false;
  if (q.get("X-Amz-Algorithm") !== "AWS4-HMAC-SHA256") return false;
  const credential = q.get("X-Amz-Credential") || "";
  const [key, date, region, service, terminal] = credential.split("/");
  if (key !== accessKeyId || !date || region !== "auto" || service !== "s3" || terminal !== "aws4_request") return false;
  const amzDate = q.get("X-Amz-Date") || "";
  if (!/^\d{8}T\d{6}Z$/.test(amzDate) || amzDate.slice(0, 8) !== date) return false;
  const expires = Number(q.get("X-Amz-Expires"));
  if (!Number.isInteger(expires) || expires < 1 || expires > 604800) return false;
  const signedHeaders = q.get("X-Amz-SignedHeaders") || "";
  if (signedHeaders !== "host") return false;
  const start = Date.parse(`${amzDate.slice(0, 4)}-${amzDate.slice(4, 6)}-${amzDate.slice(6, 8)}T${amzDate.slice(9, 11)}:${amzDate.slice(11, 13)}:${amzDate.slice(13, 15)}Z`);
  if (!Number.isFinite(start) || Date.now() >= start + expires * 1000) return false;
  const canonicalQuery = [...q.entries()]
    .filter(([name]) => name !== "X-Amz-Signature")
    .map(([name, value]) => `${uriEncode(name)}=${uriEncode(value)}`)
    .sort()
    .join("&");
  const canonicalRequest = [
    req.method,
    url.pathname,
    canonicalQuery,
    `host:${req.headers.host}\n`,
    signedHeaders,
    q.get("X-Amz-Content-Sha256") || "UNSIGNED-PAYLOAD",
  ].join("\n");
  const scope = `${date}/${region}/${service}/${terminal}`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonicalRequest)].join("\n");
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, date), region), service), "aws4_request");
  const expected = hmac(signingKey, stringToSign).toString("hex");
  let valid = false;
  try { valid = crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected)); } catch { valid = false; }
  if (!valid && process.env.MOCK_R2_DEBUG) console.error("Presign mismatch", JSON.stringify({ method: req.method, canonicalRequest, stringToSign, expected, signature }));
  return valid;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const key = decodeURIComponent(url.pathname.replace(/^\/[^/]+\//, ""));
  const requestBucket = decodeURIComponent(url.pathname.split("/")[1] || "");
  const uploadId = url.searchParams.get("uploadId");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,PUT,POST,DELETE,HEAD,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Access-Control-Expose-Headers", "ETag, Content-Length");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
  try {
    if (requestBucket !== bucketName) return xml(res, 404, "<Error><Code>NoSuchBucket</Code></Error>");
    const hasQuerySignature = url.searchParams.has("X-Amz-Signature");
    const hasHeaderSignature = String(req.headers.authorization || "").startsWith("AWS4-HMAC-SHA256");
    // Browser part PUTs and object GET/HEADs use presigned URLs; verify the
    // SigV4 method/expiry/tampering. SDK server-side operations use header auth;
    // the mock accepts the presence of that header but does not evaluate IAM.
    if (hasQuerySignature) {
      if (!verifyPresign(req, url)) { if (process.env.MOCK_R2_DEBUG) console.error("Denied", req.method, req.url, JSON.stringify(req.headers)); return xml(res, 403, "<Error><Code>AccessDenied</Code></Error>"); }
    } else if (!hasHeaderSignature) {
      return xml(res, 403, "<Error><Code>AccessDenied</Code></Error>");
    }
    if (req.method === "POST" && url.searchParams.has("uploads")) {
      const id = crypto.randomUUID();
      uploads.set(id, { key, parts: new Map(), contentType: req.headers["content-type"] || "application/octet-stream", disposition: req.headers["content-disposition"] });
      return xml(res, 200, `<InitiateMultipartUploadResult><Bucket>${esc(bucketName)}</Bucket><Key>${esc(key)}</Key><UploadId>${id}</UploadId></InitiateMultipartUploadResult>`);
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
      return xml(res, 200, `<ListPartsResult><Bucket>${esc(bucketName)}</Bucket><Key>${esc(upload.key)}</Key><UploadId>${uploadId}</UploadId><IsTruncated>false</IsTruncated>${parts.map(([n, p]) => `<Part><PartNumber>${n}</PartNumber><ETag>${esc(p.etag)}</ETag><Size>${p.data.length}</Size></Part>`).join("")}</ListPartsResult>`);
    }
    if (req.method === "POST" && uploadId) {
      const upload = uploads.get(uploadId);
      if (!upload) return xml(res, 404, "<Error><Code>NoSuchUpload</Code></Error>");
      const text = (await body(req)).toString();
      const numbers = [...text.matchAll(/<PartNumber>(\d+)<\/PartNumber>/g)].map((m) => Number(m[1]));
      const data = Buffer.concat(numbers.map((n) => upload.parts.get(n)?.data || Buffer.alloc(0)));
      objects.set(upload.key, { data, contentType: upload.contentType, disposition: upload.disposition });
      uploads.delete(uploadId);
      return xml(res, 200, `<CompleteMultipartUploadResult><Bucket>${esc(bucketName)}</Bucket><Key>${esc(upload.key)}</Key><ETag>"complete"</ETag></CompleteMultipartUploadResult>`);
    }
    if (req.method === "DELETE" && uploadId) { uploads.delete(uploadId); res.writeHead(204); res.end(); return; }
    const object = objects.get(key);
    if (!object) return xml(res, 404, "<Error><Code>NoSuchKey</Code></Error>");
    if (req.method === "HEAD") {
      res.writeHead(200, { "Content-Length": object.data.length, "Content-Type": object.contentType, "Content-Disposition": url.searchParams.get("response-content-disposition") || object.disposition || "attachment" }); res.end(); return;
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
