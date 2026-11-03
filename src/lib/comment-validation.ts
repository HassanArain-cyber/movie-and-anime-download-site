import { ApiError } from "./validation";

export function parseCommentBody(value: unknown): string {
  if (typeof value !== "string") throw new ApiError(400, "Comment must be text");
  const body = value
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u202A-\u202E\u2066-\u2069]/g, "")
    .trim();
  if (body.length < 2) throw new ApiError(400, "Comment must contain at least 2 characters");
  if (body.length > 2000) throw new ApiError(400, "Comment must be at most 2000 characters");
  if (/<\/?[a-z][^>]*>/i.test(body)) throw new ApiError(400, "Comments support plain text only; HTML is not allowed");
  if ((body.match(/https?:\/\//gi) ?? []).length > 2) throw new ApiError(400, "Please include no more than 2 links");
  return body;
}

export function parseSpoiler(value: unknown): boolean {
  if (value === undefined) return false;
  if (typeof value !== "boolean") throw new ApiError(400, "Spoiler flag must be true or false");
  return value;
}

export const COMMENT_REPORT_REASONS = ["spam", "harassment", "spoiler", "other"] as const;
export type CommentReportReason = typeof COMMENT_REPORT_REASONS[number];

export function parseReportReason(value: unknown): CommentReportReason {
  if (typeof value !== "string" || !COMMENT_REPORT_REASONS.some((reason) => reason === value)) {
    throw new ApiError(400, "Choose a valid report reason");
  }
  return value as CommentReportReason;
}

export function parseReportDetails(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new ApiError(400, "Report details must be text");
  const details = value.replace(/[\u0000-\u001F\u007F]/g, " ").trim();
  if (details.length > 500) throw new ApiError(400, "Report details must be at most 500 characters");
  if (/<\/?[a-z][^>]*>/i.test(details)) throw new ApiError(400, "Report details must be plain text");
  return details || null;
}
