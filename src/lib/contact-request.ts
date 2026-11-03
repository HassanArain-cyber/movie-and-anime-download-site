import { ApiError } from "./validation";
import { CONTACT_REQUEST_TYPES, type ContactRequest, type ContactRequestType } from "./contact-request-types";

export type { ContactRequest, ContactRequestType } from "./contact-request-types";

function cleanName(value: unknown): string {
  if (typeof value !== "string") throw new ApiError(400, "Enter your name.");
  return value.normalize("NFKC").replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim();
}

function cleanMessage(value: unknown): string {
  if (typeof value !== "string") throw new ApiError(400, "Enter a message.");
  return value.normalize("NFKC")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, "")
    .trim();
}

/** Validate and normalize untrusted public form data before it reaches email. */
export function validateContactRequest(input: Record<string, unknown>): ContactRequest {
  const name = cleanName(input.name);
  if (name.length < 1 || name.length > 100) throw new ApiError(400, "Name must be between 1 and 100 characters.");

  if (typeof input.type !== "string" || !CONTACT_REQUEST_TYPES.includes(input.type as ContactRequestType)) {
    throw new ApiError(400, "Choose a valid request type.");
  }

  const message = cleanMessage(input.message);
  if (message.length < 1 || message.length > 2000) throw new ApiError(400, "Message must be between 1 and 2000 characters.");

  return { name, type: input.type as ContactRequestType, message };
}
