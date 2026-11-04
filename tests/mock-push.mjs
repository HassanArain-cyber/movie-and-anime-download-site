import http from "node:http";
let mode = 201;
const requests = [];
const server = http.createServer(async (req, res) => {
  const chunks = []; for await (const chunk of req) chunks.push(chunk);
  const bytes = Buffer.concat(chunks);
  if (req.url === "/state") { res.setHeader("Content-Type", "application/json"); return res.end(JSON.stringify({ mode, requests })); }
  if (req.url === "/reset") { requests.length = 0; mode = 201; return res.end("{}"); }
  if (req.url === "/mode") { const body = JSON.parse(bytes); if (![201, 410, 503].includes(body.status)) { res.statusCode = 400; return res.end(); } mode = body.status; return res.end("{}"); }
  if (req.url?.startsWith("/fcm/send/vault-e2e-")) {
    requests.push({ path: req.url, headers: req.headers, body: bytes.toString("base64"), status: mode });
    res.statusCode = mode; return res.end(mode === 201 ? "" : "deliberately-private-provider-body");
  }
  res.statusCode = 404; res.end();
});
server.listen(Number(process.env.MOCK_PUSH_PORT || 9002), "127.0.0.1", () => console.log("Mock browser push service ready"));
