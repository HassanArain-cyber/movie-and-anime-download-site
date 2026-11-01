import "dotenv/config";
import { and, eq, inArray, lt } from "drizzle-orm";
import { S3Client, AbortMultipartUploadCommand } from "@aws-sdk/client-s3";
import { db, pool } from "../src/db";
import { r2Uploads } from "../src/db/schema";
import { parseR2Endpoint } from "../src/lib/r2-endpoint";

// Aborts expired incomplete multipart uploads. Completed objects are never deleted.
async function main() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!accountId || !accessKeyId || !secretAccessKey) throw new Error("R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY are required");
  const endpoint = parseR2Endpoint(process.env.R2_ENDPOINT || `https://${accountId}.r2.cloudflarestorage.com`).toString().replace(/\/$/, "");
  const s3 = new S3Client({ region: "auto", endpoint, forcePathStyle: true, credentials: { accessKeyId, secretAccessKey }, requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED" });
  const expired = await db.select().from(r2Uploads).where(and(inArray(r2Uploads.status, ["pending", "aborting"]), lt(r2Uploads.expiresAt, new Date())));
  let aborted = 0;
  for (const row of expired) {
    try {
      await s3.send(new AbortMultipartUploadCommand({ Bucket: row.bucket, Key: row.objectKey, UploadId: row.multipartUploadId }));
    } catch (error) {
      const details = error as { name?: string; $metadata?: { httpStatusCode?: number } };
      if (details.name !== "NoSuchUpload" && details.$metadata?.httpStatusCode !== 404) throw error;
    }
    await db.update(r2Uploads).set({ status: "aborted" }).where(and(eq(r2Uploads.id, row.id), inArray(r2Uploads.status, ["pending", "aborting"])));
    aborted += 1;
    console.log(`Aborted expired upload ${row.id} (${row.objectKey})`);
  }
  console.log(`Done. ${aborted} expired incomplete upload(s) aborted. Completed objects were not touched.`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => pool.end());
