type JsonRecord = Record<string, unknown>;

export type ResendErrorDiagnostics = {
  httpStatus: number;
  providerStatusCode?: number;
  code?: string;
  type?: string;
  name?: string;
  message?: string;
};

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeIdentifier(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/.test(trimmed) ? trimmed : undefined;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function redactExactValues(value: string, sensitiveValues: string[]): string {
  const distinct = [...new Set(sensitiveValues.map((item) => item.trim()).filter((item) => item.length >= 2))]
    .sort((left, right) => right.length - left.length);
  let result = value;
  for (const sensitive of distinct) {
    result = result.replace(new RegExp(escapeRegExp(sensitive), "gi"), "[redacted]");
  }
  return result;
}

function sanitizeMessage(value: unknown, sensitiveValues: string[]): string | undefined {
  if (typeof value !== "string") return undefined;

  let message = redactExactValues(value, sensitiveValues)
    .replace(/[\r\n\t\u0000-\u001f\u007f]+/g, " ")
    .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [redacted]")
    .replace(/\b(?:re|sk|rk|pk)_[A-Za-z0-9_-]{6,}\b/gi, "[redacted token]")
    .replace(/\b(api[_ -]?key|access[_ -]?token|authorization|password|secret)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}(?:\.[A-Za-z0-9_-]{10,})?\b/g, "[redacted token]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted email]")
    .replace(/https?:\/\/[^\s<>"']+/gi, "[redacted URL]")
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "[redacted IP]")
    .replace(/(?<!\w)\+?\d(?:[\s().-]*\d){7,}(?!\w)/g, "[redacted number]")
    .replace(/\s+/g, " ")
    .trim();

  if (!message) return undefined;
  return message.length > 320 ? `${message.slice(0, 317)}...` : message;
}

function safeStatusCode(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : typeof value === "string" && /^\d{3}$/.test(value) ? Number(value) : NaN;
  return Number.isInteger(parsed) && parsed >= 100 && parsed <= 599 ? parsed : undefined;
}

/**
 * Whitelist the documented Resend error fields and scrub any values that could
 * carry credentials, addresses, or contact-form content before server logging.
 */
export function makeResendErrorDiagnostics(
  httpStatus: number,
  responseBody: unknown,
  sensitiveValues: string[] = [],
): ResendErrorDiagnostics {
  const root = isRecord(responseBody) ? responseBody : {};
  const error = isRecord(root.error) ? root.error : root;
  const rawMessage = typeof error.message === "string"
    ? error.message
    : typeof root.message === "string"
      ? root.message
      : typeof root.error === "string"
        ? root.error
        : undefined;

  const diagnostics: ResendErrorDiagnostics = { httpStatus };
  const providerStatusCode = safeStatusCode(error.statusCode) ?? safeStatusCode(root.statusCode);
  const code = safeIdentifier(error.code) ?? safeIdentifier(root.code);
  const type = safeIdentifier(error.type) ?? safeIdentifier(root.type);
  const name = safeIdentifier(error.name) ?? safeIdentifier(root.name);
  const message = sanitizeMessage(rawMessage, sensitiveValues);
  if (providerStatusCode !== undefined) diagnostics.providerStatusCode = providerStatusCode;
  if (code !== undefined) diagnostics.code = code;
  if (type !== undefined) diagnostics.type = type;
  if (name !== undefined) diagnostics.name = name;
  if (message !== undefined) diagnostics.message = message;
  return diagnostics;
}
