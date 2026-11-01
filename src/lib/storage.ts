import "server-only";
import crypto from "node:crypto";
import {
  S3Client,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  ListPartsCommand,
  HeadObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { eq, and, inArray } from "drizzle-orm";
import { db } from "@/db";
import { r2Uploads } from "@/db/schema";
import { ApiError } from "./validation";
import { formatBytes } from "./media-links";
import { parseR2Endpoint } from "./r2-endpoint";
import type { CompletedUpload, InitializedUpload, StorageStatus, UploadKind, UploadPart, VideoQuality } from "./types";

const MIB = 1024 * 1024;
const GIB = 1024 * MIB;
const MAX_PARTS = 10000;
const REQUIRED = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME"] as const;
const TYPES: Record<UploadKind, Record<string, string[]>> = {
  image: {
    jpg: ["image/jpeg"], jpeg: ["image/jpeg"], png: ["image/png"],
    webp: ["image/webp"], gif: ["image/gif"],
  },
  video: {
    mp4: ["video/mp4"], webm: ["video/webm"], mkv: ["video/x-matroska"],
    mov: ["video/quicktime"], avi: ["video/x-msvideo", "video/avi"],
    m4v: ["video/x-m4v", "video/mp4"],
  },
  archive: {
    zip: ["application/zip", "application/x-zip-compressed"],
    rar: ["application/vnd.rar", "application/x-rar-compressed", "application/octet-stream"],
    "7z": ["application/x-7z-compressed", "application/octet-stream"],
  },
};

type R2Config = { endpoint: string; bucket: string; accessKeyId: string; secretAccessKey: string; downloadTtl: number; uploadTtl: number };
export type UploadRow = typeof r2Uploads.$inferSelect;
export type UploadTarget = { mediaId: number | null; seasonId: number | null; episodeId: number | null; quality: VideoQuality | null };

function boundedNumber(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new ApiError(503, `${name} is outside its supported range`);
  return value;
}

export function getStorageStatus(): StorageStatus {
  return {
    configured: REQUIRED.every((key) => !!process.env[key]?.trim()),
    missing: REQUIRED.filter((key) => !process.env[key]?.trim()),
    maxVideoBytes: boundedNumber("R2_MAX_VIDEO_BYTES", 10 * GIB, 1, 5 * 1024 * GIB),
    maxImageBytes: boundedNumber("R2_MAX_IMAGE_BYTES", 10 * MIB, 1, 100 * MIB),
    partSizeBytes: boundedNumber("R2_PART_SIZE_BYTES", 16 * MIB, 5 * MIB, 5 * GIB),
    privateDownloads: true,
  };
}

function getConfig(): R2Config {
  const status = getStorageStatus();
  if (!status.configured) throw new ApiError(503, `Cloudflare R2 is not configured. Set: ${status.missing.join(", ")}`);
  const accountId = process.env.R2_ACCOUNT_ID!.trim();
  if (!/^[a-zA-Z0-9-]+$/.test(accountId)) throw new ApiError(503, "R2_ACCOUNT_ID is invalid");
  let endpoint: URL;
  try { endpoint = parseR2Endpoint(process.env.R2_ENDPOINT?.trim() || `https://${accountId}.r2.cloudflarestorage.com`); }
  catch (error) { throw new ApiError(503, (error as Error).message); }
  return {
    endpoint: endpoint.toString().replace(/\/$/, ""),
    bucket: process.env.R2_BUCKET_NAME!.trim(),
    accessKeyId: process.env.R2_ACCESS_KEY_ID!.trim(),
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!.trim(),
    downloadTtl: boundedNumber("R2_DOWNLOAD_URL_TTL_SECONDS", 3600, 60, 86400),
    uploadTtl: boundedNumber("R2_UPLOAD_URL_TTL_SECONDS", 21600, 300, 86400),
  };
}

function client(config: R2Config): S3Client {
  return new S3Client({
    region: "auto",
    endpoint: config.endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
    maxAttempts: 3,
  });
}

function storageError(error: unknown): never {
  if (error instanceof ApiError) throw error;
  const details = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  console.error("R2 operation failed:", details.name || "UnknownError", details.$metadata?.httpStatusCode || "");
  if (details.name === "NoSuchUpload" || details.$metadata?.httpStatusCode === 404) throw new ApiError(410, "This upload no longer exists in R2. Start a new upload.");
  if (details.$metadata?.httpStatusCode === 403 || details.name === "AccessDenied") throw new ApiError(502, "R2 denied access. Check the bucket credentials and permissions.");
  throw new ApiError(502, "Cloudflare R2 could not complete the request. Your existing files and links were not changed.");
}

export function validateUploadFile(input: { kind: unknown; fileName: unknown; sizeBytes: unknown; contentType?: unknown }) {
  const status = getStorageStatus();
  if (input.kind !== "image" && input.kind !== "video" && input.kind !== "archive") throw new ApiError(400, "Upload kind must be image, video, or archive");
  const kind = input.kind as UploadKind;
  if (typeof input.fileName !== "string" || input.fileName.length > 1024) throw new ApiError(400, "A valid file name is required");
  const originalName = input.fileName.split(/[\\/]/).pop() || "file";
  const extension = originalName.match(/\.([a-z0-9]+)$/i)?.[1].toLowerCase();
  if (!extension || !TYPES[kind][extension]) {
    throw new ApiError(400, `Unsupported ${kind} format. Allowed: ${Object.keys(TYPES[kind]).join(", ")}`);
  }
  const allowedMimes = TYPES[kind][extension];
  const suppliedMime = typeof input.contentType === "string" ? input.contentType.split(";")[0].trim().toLowerCase() : "";
  if (suppliedMime && suppliedMime !== "application/octet-stream" && !allowedMimes.includes(suppliedMime)) {
    throw new ApiError(400, "The file type does not match its extension");
  }
  const sizeBytes = input.sizeBytes;
  if (typeof sizeBytes !== "number" || !Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) throw new ApiError(400, "File size must be a positive integer");
  const maxSize = kind === "image" ? status.maxImageBytes : status.maxVideoBytes;
  if (sizeBytes > maxSize) throw new ApiError(413, `File is too large. Maximum ${kind} size is ${formatBytes(maxSize)}.`);
  const partSize = Math.ceil(Math.max(status.partSizeBytes, sizeBytes / MAX_PARTS) / MIB) * MIB;
  if (partSize > 5 * GIB || Math.ceil(sizeBytes / partSize) > MAX_PARTS) throw new ApiError(413, "File requires too many upload parts");
  const safeName = originalName.normalize("NFKC").replace(/[\x00-\x1f\x7f]/g, "").replace(/[^a-zA-Z0-9._ -]/g, "_").replace(/^\.+/, "").trim().slice(0, 160) || `file.${extension}`;
  const fileName = safeName.toLowerCase().endsWith(`.${extension}`) ? safeName : `${safeName.slice(0, 140)}.${extension}`;
  return { kind, fileName, sizeBytes, partSize, contentType: allowedMimes[0], maxSize };
}

async function listParts(s3: S3Client, row: UploadRow) {
  const parts: { partNumber: number; sizeBytes: number; etag: string }[] = [];
  let marker: string | undefined;
  do {
    const result = await send(() => s3.send(new ListPartsCommand({ Bucket: row.bucket, Key: row.objectKey, UploadId: row.multipartUploadId, PartNumberMarker: marker, MaxParts: 1000 })));
    for (const part of result.Parts || []) {
      if (part.PartNumber && part.ETag) parts.push({ partNumber: part.PartNumber, sizeBytes: part.Size || 0, etag: part.ETag });
    }
    marker = result.IsTruncated ? result.NextPartNumberMarker : undefined;
  } while (marker);
  return parts.sort((a, b) => a.partNumber - b.partNumber);
}

async function send<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation(); } catch (error) { storageError(error); }
}

async function presignParts(s3: S3Client, config: R2Config, row: UploadRow): Promise<Pick<InitializedUpload, "parts" | "uploadedParts" | "urlExpiresAt">> {
  const count = Math.ceil(row.sizeBytes / row.partSize);
  const uploaded = await listParts(s3, row);
  const parts: UploadPart[] = [];
  // Bound signing concurrency for very large files.
  for (let offset = 0; offset < count; offset += 50) {
    const batch = await Promise.all(Array.from({ length: Math.min(50, count - offset) }, async (_, index) => {
      const partNumber = offset + index + 1;
      const command = new UploadPartCommand({ Bucket: row.bucket, Key: row.objectKey, UploadId: row.multipartUploadId, PartNumber: partNumber });
      // Do not add Content-Type here: UploadPart does not accept it, and the
      // browser sends file.slice() blobs with an empty type. The final object
      // content type is set by CreateMultipartUpload.
      return { partNumber, url: await getSignedUrl(s3, command, { expiresIn: config.uploadTtl }), headers: {} };
    }));
    parts.push(...batch);
  }
  return { parts, uploadedParts: uploaded.map(({ partNumber, sizeBytes }) => ({ partNumber, sizeBytes })), urlExpiresAt: new Date(Date.now() + config.uploadTtl * 1000).toISOString() };
}

export async function initializeUpload(input: { kind: unknown; fileName: unknown; sizeBytes: unknown; contentType?: unknown; target: UploadTarget }): Promise<InitializedUpload> {
  const config = getConfig();
  const file = validateUploadFile(input);
  const s3 = client(config);
  const id = crypto.randomUUID();
  const folder = file.kind === "image" ? "images" : file.kind === "archive" ? "archives" : "videos";
  const objectKey = `${folder}/${input.target.mediaId ? `media-${input.target.mediaId}/` : ""}${crypto.randomUUID()}/${file.fileName}`;
  const created = await send(() => s3.send(new CreateMultipartUploadCommand({
    Bucket: config.bucket,
    Key: objectKey,
    ContentType: file.contentType,
    ContentDisposition: contentDisposition(file.fileName, true),
    CacheControl: "private, max-age=0, no-cache",
    Metadata: { "original-name": encodeURIComponent(file.fileName).slice(0, 1024), "upload-id": id },
  })));
  if (!created.UploadId) throw new ApiError(502, "R2 did not return a multipart upload ID");
  const row: typeof r2Uploads.$inferInsert = {
    id, objectKey, bucket: config.bucket, multipartUploadId: created.UploadId,
    kind: file.kind, status: "pending", fileName: file.fileName, contentType: file.contentType,
    sizeBytes: file.sizeBytes, partSize: file.partSize,
    ...input.target,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  };
  try { await db.insert(r2Uploads).values(row); }
  catch (error) {
    await s3.send(new AbortMultipartUploadCommand({ Bucket: config.bucket, Key: objectKey, UploadId: created.UploadId })).catch(() => undefined);
    throw error;
  }
  const saved = row as UploadRow;
  const signed = await presignParts(s3, config, saved);
  return { id, kind: file.kind, fileName: file.fileName, sizeBytes: file.sizeBytes, partSizeBytes: file.partSize, ...signed };
}

export async function getUpload(id: string): Promise<UploadRow> {
  const [row] = await db.select().from(r2Uploads).where(eq(r2Uploads.id, id)).limit(1);
  if (!row) throw new ApiError(404, "Upload not found");
  return row;
}

function assertUploadBucket(row: UploadRow, config: R2Config): void {
  if (row.bucket !== config.bucket) throw new ApiError(409, "This upload belongs to a different R2 bucket");
}

function assertUploadActive(row: UploadRow): void {
  if (row.expiresAt.getTime() <= Date.now()) throw new ApiError(410, "This upload session has expired. Start a new upload.");
}

export async function refreshUpload(id: string): Promise<InitializedUpload> {
  const row = await getUpload(id);
  if (row.status !== "pending") throw new ApiError(409, `Upload is ${row.status}, not pending`);
  const config = getConfig();
  assertUploadBucket(row, config);
  assertUploadActive(row);
  const signed = await presignParts(client(config), config, row);
  return { id, kind: row.kind as UploadKind, fileName: row.fileName, sizeBytes: row.sizeBytes, partSizeBytes: row.partSize, ...signed };
}

export function completedUpload(row: UploadRow): CompletedUpload {
  return {
    id: row.id,
    url: `r2:///${row.objectKey}`,
    ...(row.kind === "image" ? { imageUrl: `/api/image?upload=${row.id}` } : {}),
    objectKey: row.objectKey, fileName: row.fileName, sizeBytes: row.sizeBytes,
    contentType: row.contentType, kind: row.kind as UploadKind, quality: row.quality as VideoQuality | null,
  };
}

export async function completeUpload(id: string): Promise<CompletedUpload> {
  const row = await getUpload(id);
  const config = getConfig();
  assertUploadBucket(row, config);
  if (row.status === "completed") return completedUpload(row);
  if (row.status === "failed") {
    assertUploadActive(row);
    // Claim before recovery so an abort cannot race a failed-upload recovery.
    const [claimed] = await db.update(r2Uploads).set({ status: "completing" })
      .where(and(eq(r2Uploads.id, id), eq(r2Uploads.status, "failed"))).returning();
    if (!claimed) throw new ApiError(409, "Upload status changed; refresh before trying again");
    // A previous completion may have succeeded in R2 after a network timeout.
    // Recover only if the final object exists and its size matches exactly.
    try {
      const head = await client(config).send(new HeadObjectCommand({ Bucket: row.bucket, Key: row.objectKey }));
      if (head.ContentLength === row.sizeBytes) {
        const [recovered] = await db.update(r2Uploads).set({ status: "completed", completedAt: new Date() }).where(eq(r2Uploads.id, id)).returning();
        return completedUpload(recovered);
      }
    } catch { /* fall through */ }
    await db.update(r2Uploads).set({ status: "failed" }).where(eq(r2Uploads.id, id));
    throw new ApiError(409, "Upload failed verification. Start a new upload.");
  }
  if (row.status !== "pending") throw new ApiError(409, `Upload is ${row.status}. Refresh before trying again.`);
  assertUploadActive(row);
  const s3 = client(config);
  const parts = await listParts(s3, row);
  const expectedCount = Math.ceil(row.sizeBytes / row.partSize);
  const valid = parts.length === expectedCount && parts.every((part, index) =>
    part.partNumber === index + 1 && part.sizeBytes === (index === expectedCount - 1 ? row.sizeBytes - row.partSize * index : row.partSize)
  );
  if (!valid) throw new ApiError(400, "Upload is incomplete or its part sizes do not match. Resume the upload before saving.");
  const [claimed] = await db.update(r2Uploads).set({ status: "completing" }).where(and(eq(r2Uploads.id, id), eq(r2Uploads.status, "pending"))).returning();
  if (!claimed) {
    const fresh = await getUpload(id);
    if (fresh.status === "completed") return completedUpload(fresh);
    throw new ApiError(409, "Upload completion is already in progress");
  }
  try {
    await send(() => s3.send(new CompleteMultipartUploadCommand({ Bucket: row.bucket, Key: row.objectKey, UploadId: row.multipartUploadId, MultipartUpload: { Parts: parts.map(({ partNumber, etag }) => ({ PartNumber: partNumber, ETag: etag })) } })));
    const head = await send(() => s3.send(new HeadObjectCommand({ Bucket: row.bucket, Key: row.objectKey })));
    if (head.ContentLength !== row.sizeBytes) throw new ApiError(502, "R2 object size verification failed; the file was not attached");
    const [completed] = await db.update(r2Uploads).set({ status: "completed", completedAt: new Date() }).where(eq(r2Uploads.id, id)).returning();
    return completedUpload(completed);
  } catch (error) {
    // A timeout can occur after R2 has completed the object. Never delete it.
    const fresh = await getUpload(id).catch(() => row);
    if (fresh.status !== "completed") await db.update(r2Uploads).set({ status: "failed" }).where(eq(r2Uploads.id, id));
    throw error;
  }
}

export async function abortUpload(id: string): Promise<void> {
  const row = await getUpload(id);
  if (row.status === "completed") throw new ApiError(409, "Completed files are retained. Deleting a link does not delete its R2 object.");
  if (row.status === "aborted") return;
  if (row.status === "completing" || row.status === "aborting") throw new ApiError(409, "Wait for the current upload operation to finish before cancelling");
  const config = getConfig();
  assertUploadBucket(row, config);
  // Claim the row before touching R2 so a concurrent completion cannot race an abort.
  const [claimed] = await db.update(r2Uploads).set({ status: "aborting" })
    .where(and(eq(r2Uploads.id, id), inArray(r2Uploads.status, ["pending", "failed"]))).returning();
  if (!claimed) throw new ApiError(409, "Upload status changed; refresh before trying again");
  try {
    await client(config).send(new AbortMultipartUploadCommand({ Bucket: row.bucket, Key: row.objectKey, UploadId: row.multipartUploadId }));
  } catch (error) {
    const details = error as { name?: string; $metadata?: { httpStatusCode?: number } };
    if (details.name !== "NoSuchUpload" && details.$metadata?.httpStatusCode !== 404) {
      await db.update(r2Uploads).set({ status: "failed" }).where(eq(r2Uploads.id, id));
      storageError(error);
    }
  }
  await db.update(r2Uploads).set({ status: "aborted" }).where(eq(r2Uploads.id, id));
}

function contentDisposition(fileName: string, attachment: boolean): string {
  const ascii = fileName.replace(/[^a-zA-Z0-9._ -]/g, "_").replace(/["\\]/g, "_");
  return `${attachment ? "attachment" : "inline"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)}`;
}

export async function signedObjectUrl(row: Pick<UploadRow, "bucket" | "objectKey" | "fileName" | "contentType" | "kind">, method: "GET" | "HEAD" = "GET"): Promise<string> {
  const config = getConfig();
  if (row.bucket !== config.bucket) throw new ApiError(404, "Object is not in the configured bucket");
  const overrides = {
    Bucket: row.bucket, Key: row.objectKey,
    ResponseContentDisposition: contentDisposition(row.fileName, row.kind !== "image"),
    ResponseContentType: row.contentType,
  };
  // SigV4 signs the HTTP method. A GET-signed URL is not valid for HEAD.
  const command = method === "HEAD" ? new HeadObjectCommand(overrides) : new GetObjectCommand(overrides);
  return getSignedUrl(client(config), command, { expiresIn: config.downloadTtl });
}

export function r2LinkValues(row: UploadRow, target: UploadTarget) {
  if (row.status !== "completed" || row.kind === "image") throw new ApiError(409, "Complete the video/archive upload before attaching it");
  assertUploadBucket(row, getConfig());
  if (row.mediaId !== target.mediaId || row.seasonId !== target.seasonId || row.episodeId !== target.episodeId || row.quality !== target.quality) {
    throw new ApiError(400, "The uploaded file belongs to a different media item, episode, or quality");
  }
  return { url: `r2:///${row.objectKey}`, objectKey: row.objectKey, storageProvider: "r2", isUploaded: true, sizeBytes: row.sizeBytes, fileSize: formatBytes(row.sizeBytes), quality: row.quality };
}
