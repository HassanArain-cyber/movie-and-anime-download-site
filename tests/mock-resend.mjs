import http from "node:http";

const port = Number(process.env.MOCK_RESEND_PORT || 9001);
const apiKey = process.env.MOCK_RESEND_API_KEY || "test-resend-key";
let lastMessage = null;

const server = http.createServer(async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  if (req.method === "GET" && req.url === "/last") {
    res.end(JSON.stringify(lastMessage));
    return;
  }
  if (req.method !== "POST" || req.url !== "/emails") {
    res.writeHead(404).end(JSON.stringify({ error: "not found" }));
    return;
  }
  if (req.headers.authorization !== `Bearer ${apiKey}`) {
    res.writeHead(401).end(JSON.stringify({ error: "unauthorized" }));
    return;
  }

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  let body;
  try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch {
    res.writeHead(400).end(JSON.stringify({ error: "invalid json" }));
    return;
  }
  if (typeof body.text === "string" && body.text.includes("[MOCK_FAIL]")) {
    res.writeHead(422).end(JSON.stringify({ error: "simulated provider rejection" }));
    return;
  }
  if (typeof body.from !== "string" || !Array.isArray(body.to) || typeof body.subject !== "string" || typeof body.text !== "string") {
    res.writeHead(422).end(JSON.stringify({ error: "missing message fields" }));
    return;
  }
  lastMessage = { from: body.from, to: body.to, subject: body.subject, text: body.text };
  res.writeHead(200).end(JSON.stringify({ id: "mock-email-id" }));
});

server.listen(port, "127.0.0.1", () => console.log(`Mock Resend listening on 127.0.0.1:${port}`));
