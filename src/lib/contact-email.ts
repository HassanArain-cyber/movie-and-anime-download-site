import "server-only";
import { ApiError } from "./validation";
import type { ContactRequest } from "./contact-request";

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
  // Local mock endpoint is permitted only for development/test runs. Production
  // always uses Resend's fixed HTTPS endpoint, preventing an env-based SSRF path.
  if (process.env.NODE_ENV === "production") throw new ApiError(503, "Email sending is not configured correctly.");
  let url: URL;
  try { url = new URL(override); } catch { throw new ApiError(503, "Email sending is not configured correctly."); }
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const loopback = new Set(["localhost", "127.0.0.1", "::1"]);
  if (url.protocol !== "http:" || !loopback.has(host) || url.username || url.password || url.pathname !== "/emails" || url.search || url.hash) {
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
    throw new ApiError(503, "Request email is not configured. Please contact the site administrator.");
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
    throw new ApiError(502, "We couldn’t send your request right now. Please try again later.");
  }

  if (!response.ok) {
    // Do not log or return the provider response body; it can contain user data.
    console.error("Contact email provider rejected a request:", response.status);
    throw new ApiError(502, "We couldn’t send your request right now. Please try again later.");
  }
}
