/** Pure endpoint validation shared by the app and tests (no server-only import). */
export function parseR2Endpoint(value: string): URL {
  let endpoint: URL;
  try { endpoint = new URL(value); } catch { throw new Error("R2_ENDPOINT is invalid"); }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname);
  if (endpoint.protocol !== "https:" && !(endpoint.protocol === "http:" && loopback)) {
    throw new Error("R2_ENDPOINT must use HTTPS (HTTP is allowed only for a loopback test endpoint)");
  }
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== "/") {
    throw new Error("R2_ENDPOINT must be an origin without credentials, path, query, or fragment");
  }
  return endpoint;
}
