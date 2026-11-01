import "dotenv/config";
import crypto from "node:crypto";
import { and, eq, inArray, lt, or, isNull } from "drizzle-orm";
import { S3Client, AbortMultipartUploadCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { db, pool } from "../src/db";
import { r2Uploads } from "../src/db/schema";
import { parseR2Endpoint } from "../src/lib/r2-endpoint";

const LEASE_MS = 10 * 60 * 1000;

// Aborts expired incomplete multipart uploads and recovers crashed transitions.
// Completed objects are never deleted. Only the configured bucket is touched.
async function main() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET_NAME;
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    throw new Error("R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET_NAME are required");
  }
  const endpoint = parseR2Endpoint(process.env.R2_ENDPOINT || `https://${accountId}.r2.cloudflarestorage.com`).toString().replace(/\/$/, "");
  const s3 = new S3Client({
    region: "auto", endpoint, forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
    requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED",
  });
  const now = new Date();
  const expired = await db.select().from(r2Uploads).where(and(
    eq(r2Uploads.bucket, bucket),
    or(
      and(inArray(r2Uploads.status, ["pending", "failed"]), lt(r2Uploads.expiresAt, now), or(isNull(r2Uploads.operationExpiresAt), lt(r2Uploads.operationExpiresAt, now))),
      and(inArray(r2Uploads.status, ["completing", "aborting"]), or(isNull(r2Uploads.operationExpiresAt), lt(r2Uploads.operationExpiresAt, now))),
    ),
  ));
  let aborted = 0;
  let recovered = 0;
  for (const row of expired) {
    const operationId = crypto.randomUUID();
    const [claimed] = await db.update(r2Uploads)
      .set({ status: "aborting", operationId, operationExpiresAt: new Date(Date.now() + LEASE_MS) })
      .where(and(
        eq(r2Uploads.id, row.id), eq(r2Uploads.bucket, bucket), eq(r2Uploads.status, row.status),
        or(isNull(r2Uploads.operationId), eq(r2Uploads.operationId, row.operationId!)),
        or(
          and(inArray(r2Uploads.status, ["pending", "failed"]), lt(r2Uploads.expiresAt, new Date()), or(isNull(r2Uploads.operationExpiresAt), lt(r2Uploads.operationExpiresAt, new Date()))),
          and(inArray(r2Uploads.status, ["completing", "aborting"]), or(isNull(r2Uploads.operationExpiresAt), lt(r2Uploads.operationExpiresAt, new Date()))),
        ),
      )).returning();
    if (!claimed) continue;
    const markCompleted = async () => {
      await db.update(r2Uploads).set({ status: "completed", completedAt: new Date(), operationId: null, operationExpiresAt: null })
        .where(and(eq(r2Uploads.id, claimed.id), eq(r2Uploads.operationId, operationId)));
      recovered += 1;
      console.log(`Recovered completed upload ${claimed.id} (${claimed.objectKey})`);
    };
    const exists = async () => {
      try {
        const head = await s3.send(new HeadObjectCommand({ Bucket: claimed.bucket, Key: claimed.objectKey }));
        return head.ContentLength === claimed.sizeBytes;
      } catch (error) {
        const details = error as { name?: string; $metadata?: { httpStatusCode?: number } };
        if (details.name === "NoSuchKey" || details.$metadata?.httpStatusCode === 404) return false;
        throw error;
      }
    };
    try {
      if (await exists()) {
        await markCompleted();
        continue;
      }
      await s3.send(new AbortMultipartUploadCommand({ Bucket: claimed.bucket, Key: claimed.objectKey, UploadId: claimed.multipartUploadId }));
    } catch (error) {
      const details = error as { name?: string; $metadata?: { httpStatusCode?: number } };
      if (details.name === "NoSuchUpload" || details.$metadata?.httpStatusCode === 404) {
        // Completion may have won the race; retain and recover the object instead.
        if (await exists()) {
          await markCompleted();
          continue;
        }
      } else {
        await db.update(r2Uploads).set({ operationId: null, operationExpiresAt: null })
          .where(and(eq(r2Uploads.id, claimed.id), eq(r2Uploads.operationId, operationId)));
        throw error;
      }
    }
    await db.update(r2Uploads).set({ status: "aborted", operationId: null, operationExpiresAt: null })
      .where(and(eq(r2Uploads.id, claimed.id), eq(r2Uploads.operationId, operationId)));
    aborted += 1;
    console.log(`Aborted expired upload ${claimed.id} (${claimed.objectKey})`);
  }
  console.log(`Done. ${aborted} expired incomplete upload(s) aborted, ${recovered} completed upload(s) recovered. Completed objects were not touched.`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => pool.end());
