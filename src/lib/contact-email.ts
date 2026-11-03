import "server-only";
import { ApiError } from "./validation";
import type { ContactRequest } from "./contact-request-types";
import { makeResendErrorDiagnostics } from "./resend-error-diagnostics";

const RESEND_EMAILS_URL = "https://api.resend.com/emails";

function isMailbox(value: string): boolean {
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value);
}

function getSender(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length > 254 || /[\r\n]/.test(trimmed)) return null;
  const angle = trimmed.match(/^(?:[^<>\r\n]{1,80}\s*)<([^<>\s]+)>$/);
  const mailbox = angle?.[1] ?? trimmed;
  return isMailbox(mailbox) ? trimmed : null;
}

function getResendEndpoint(): string {
  const override = process.env.RESEND_API_URL?.trim();
  if (!override) return RESEND_EMAILS_URL;
  // Local mock endpoint is permitted only outside production. Production always
  // uses Resend's fixed HTTPS endpoint to prevent an env-based SSRF path.
  if (process.env.NODE_ENV === "production") throw new ApiError(503, "Email sending is not configured correctly.");
  let url: URL;
  try { url = new URL(override); } catch { throw new ApiError(503, "Email sending is not configured correctly."); }
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (url.protocol !== "http:" || !new Set(["localhost", "127.0.0.1", "::1"]).has(host) || url.username || url.password || url.pathname !== "/emails" || url.search || url.hash) {
    throw new ApiError(503, "Email sending is not configured correctly.");
  }
  return url.toString();
}

export async function sendContactEmail(request: ContactRequest): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const recipient = process.env.ADMIN_EMAIL?.trim();
  const senderRaw = process.env.RESEND_FROM_EMAIL?.trim();
  const sender = senderRaw ? getSender(senderRaw) : null;
  if (!apiKey || !recipient || !isMailbox(recipient) || !sender) {
    throw new ApiError(503, "Request email is not configured.");
  }

  const message = [
    "A new request was submitted through the Vault website.",
    "",
    `Name: ${request.name}`,
    `Request type: ${request.type}`,
    "",
    "Message:",
    request.message,
  ].join("\n");

  let response: Response;
  try {
    response = await fetch(getResendEndpoint(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: sender,
        to: [recipient],
        subject: `[Vault] ${request.type} request`,
        text: message,
      }),
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
  } catch (error) {
    console.error("Contact email provider request failed:", error instanceof Error ? error.name : "unknown");
    throw new ApiError(502, "Email notification could not be sent.");
  }

  if (!response.ok) {
    // Temporary diagnostic: whitelist Resend's documented error fields and scrub
    // request data, addresses, credentials, and other common PII before logging.
    let responseBody: unknown;
    try { responseBody = await response.json(); } catch { responseBody = null; }
    const diagnostics = makeResendErrorDiagnostics(response.status, responseBody, [
      apiKey,
      recipient,
      senderRaw ?? "",
      sender,
      request.name,
      request.message,
      ...request.name.split(/\s+/),
      ...request.message.split(/\s+/),
    ]);
    console.error("Contact email provider rejected a request:", JSON.stringify(diagnostics));
    throw new ApiError(502, "Email notification could not be sent.");
  }
}
