import "server-only";
import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { classifyHeadStatus, isPublicIPv4, safeProbeUrl, type LinkCheck } from "./link-health";

const TIMEOUT_MS = 4000;

/**
 * Audit external HTTPS links without following redirects or downloading files.
 * DNS answers are checked and the connection is pinned to a public IPv4
 * address. This prevents a stored URL from reaching a private network.
 */
export async function checkExternalLink(raw: string): Promise<LinkCheck> {
  const url = safeProbeUrl(raw);
  if (!url) return { status: "review", reason: "Cannot safely verify this URL automatically." };

  try {
    const addresses = await lookup(url.hostname, { all: true, family: 4 });
    if (!addresses.length || addresses.some((item) => !isPublicIPv4(item.address))) {
      return { status: "review", reason: "No safe public IPv4 destination was found." };
    }

    return await new Promise<LinkCheck>((resolve) => {
      const check = request(url, {
        method: "HEAD",
        timeout: TIMEOUT_MS,
        maxHeaderSize: 8192,
        headers: { "User-Agent": "Vault-Link-Audit/1.0" },
        // DNS is resolved only once: the socket cannot be redirected to another IP.
        lookup: (_host, _options, callback) => callback(null, addresses[0].address, 4),
      }, (response) => {
        const result = classifyHeadStatus(response.statusCode ?? 0);
        response.resume();
        resolve(result);
      });
      check.on("timeout", () => check.destroy(new Error("timeout")));
      check.on("error", () => resolve({
        status: "review", reason: "Provider did not answer the safe check. Try opening the source manually.",
      }));
      check.end();
    });
  } catch {
    return { status: "review", reason: "Provider lookup failed. Try the source manually." };
  }
}
