# Cloudflare R2 setup

The integration uses the S3-compatible R2 API from Next.js route handlers and presigned multipart URLs in the browser. R2 credentials are server-only and are never sent to the client.

## 1. Create a private bucket

1. Cloudflare dashboard → R2 → Create bucket.
2. Keep public access disabled. Do not enable the public `r2.dev` development URL for private media.
3. Note the bucket name and your Cloudflare account ID.

## 2. Create an R2 API token

Create an R2 token with Object Read & Write scoped to the media bucket. The app needs permission to create/complete/abort multipart uploads, list parts, write objects, and read objects for signed downloads.

Example least-privilege policy (replace `BUCKET`):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:AbortMultipartUpload",
        "s3:ListMultipartUploadParts"
      ],
      "Resource": "arn:aws:s3:::BUCKET/*"
    },
    {
      "Effect": "Allow",
      "Action": "s3:ListBucketMultipartUploads",
      "Resource": "arn:aws:s3:::BUCKET"
    }
  ]
}
```

## 3. Configure CORS for browser uploads

Bucket → Settings → CORS Policy. Replace the origin with your deployed site origin. For local development you can add `http://localhost:3000`.

```json
[
  {
    "AllowedOrigins": ["https://your-site.example"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag", "Content-Length"],
    "MaxAgeSeconds": 3600
  }
]
```

The browser uploads parts with `PUT`; the browser does not need cross-origin `GET`, `POST`, or `DELETE` access for the current UI. Downloads are ordinary navigations/redirects to signed R2 URLs, so they do not require CORS. If you later add browser-side `fetch()` downloads, add only the methods you actually use. Do not use `*` for a production admin origin unless you intentionally accept any site. CORS is not an authorization control: anyone holding a valid presigned URL can use it from any client until it expires.

## 4. Environment variables

Set these on the server/hosting platform, not in client-side code:

```dotenv
DATABASE_URL=postgresql://...
ADMIN_PASSWORD=use-a-long-random-password
# Optional but recommended behind a proxy:
# APP_ORIGIN=https://your-site.example
# Only set this to a single-IP header your trusted proxy overwrites:
# ADMIN_LOGIN_TRUSTED_IP_HEADER=x-real-ip
ADMIN_LOGIN_WINDOW_SECONDS=900
ADMIN_LOGIN_MAX_ATTEMPTS=5
ADMIN_LOGIN_GLOBAL_MAX_ATTEMPTS=30

R2_ACCOUNT_ID=your-account-id
R2_ACCESS_KEY_ID=your-access-key-id
R2_SECRET_ACCESS_KEY=your-secret-access-key
R2_BUCKET_NAME=your-private-bucket
# Optional; defaults to https://<account-id>.r2.cloudflarestorage.com
# R2_ENDPOINT=

# Optional tuning
R2_MAX_VIDEO_BYTES=10737418240
R2_MAX_IMAGE_BYTES=10485760
R2_PART_SIZE_BYTES=16777216
R2_DOWNLOAD_URL_TTL_SECONDS=3600
R2_UPLOAD_URL_TTL_SECONDS=21600
```

`R2_PART_SIZE_BYTES` must be between 5 MiB and 2047 MiB (the largest whole-MiB value that fits the PostgreSQL `part_size` integer column). The app automatically increases part size for very large files so the 10,000-part limit is respected. Video/archive uploads default to a 10 GiB per-file limit; images default to 10 MiB. The configured maximum video/archive size may be raised up to 5 TiB, but real R2 account/object limits and browser/network behavior must be verified before doing so.

Upload sessions last 24 hours and slide forward when part URLs are refreshed. Presigned part URLs default to 6 hours. Completion/abort operations hold a 10-minute database lease; a crashed operation can be recovered or cleaned up after the lease expires. The browser uploads at most 3 parts concurrently and retries a failed part up to 3 times. Resume requires the same file size, kind, target, and quality; choose the same file again.

## 5. Migrate and deploy

```bash
npm ci
npm run db:migrate
npm run build
npm start
```

Back up the database before migrating, for example with `pg_dump` against the correct database. The migrations are additive and do not rewrite existing URLs. The app does not auto-migrate on startup. `0003_upload_operation_lease` adds nullable operation-lease columns to `r2_uploads`.

Migrations run in a transaction. Index/constraint creation can lock tables, so use a maintenance window for a large existing database. The upgrade path is covered by `node tests/migration-upgrade.mjs` against a disposable loopback database; it is not a substitute for a production backup and restore rehearsal.

## 6. Verify in the admin panel

1. Sign in at `/admin`.
2. Create or edit a movie/anime/series.
3. Upload a small poster, then a small MP4. The upload control should show progress and “Uploaded and verified in R2”.
4. Save the link. The public detail page should show a quality-labelled download button.
5. Click the download button. The app redirects to a short-lived signed R2 URL.
6. Add a Telegram link and confirm it opens Telegram rather than R2.

`GET /api/storage/status` (admin-only) reports whether the required R2 variables are present. It never returns secret values.

## Lifecycle and cleanup

Incomplete multipart uploads can consume storage. Configure an R2 lifecycle rule to abort incomplete multipart uploads after a few days, and/or run:

```bash
npm run r2:cleanup
```

The cleanup script is bucket-scoped and only touches rows in `R2_BUCKET_NAME`. It aborts expired `pending`/`failed` sessions and recovers or aborts stale `completing`/`aborting` sessions whose operation lease has expired. Before aborting it checks whether the final object already exists; a completed object is recovered, never deleted. Active leases are skipped. Run it periodically (for example daily) and configure an R2 lifecycle rule to abort incomplete multipart uploads after several days as a backstop.

Deleting a download link, episode, season, or media row in the admin panel does not delete R2 objects. Completed objects are retained until you intentionally remove them in Cloudflare. This preserves data but means orphaned objects can accumulate; review the bucket periodically.

## Legacy local files

Existing `/uploads/...` links still work through `/api/download` if the files exist under `public/uploads` on the server. New uploads no longer write there. If your deployment filesystem is ephemeral, preserve legacy files on persistent storage or re-upload them through the admin panel. The app does not silently delete or move old files.

## Security notes

- Keep the bucket private. Video/archive downloads use signed GET URLs.
- Posters use `/api/image?upload=...`, which redirects to a signed image URL. Only completed image uploads are exposed there.
- `ADMIN_PASSWORD` is required and must be at least 8 characters. The old `admin123` default is removed. Login attempts are rate-limited in PostgreSQL; see `docs/SECURITY_REVIEW.md` for proxy-trust configuration.
- External links are restricted to HTTP(S), Telegram (`tg:`), and magnet URLs. `javascript:`/`data:` links are not rendered as clickable downloads.
- Local legacy downloads are path-contained and must correspond to a recorded database URL. Direct `/api/download?url=...` redirects also require a recorded URL.
- Upload sessions expire and are bound to the configured bucket. HEAD downloads use HEAD-signed URLs.
- New poster/thumbnail URLs reject unsafe schemes and private-network IP literals. The image optimizer is restricted to local `/uploads/**`; external/R2 images are rendered unoptimized. Hostname validation is not a DNS rebinding defense, so do not re-enable arbitrary remote optimization without a separate egress control.
- Legacy files under `public/uploads` are still served directly by the web server if present. They are not made private by this PR. Re-upload sensitive legacy media to R2 and remove the public copies through a separate, backed-up migration if needed.
- Real Cloudflare IAM, CORS, lifecycle rules, and very-large-file behavior are not verified by the local mock. Before production use, test a small real upload/download, a denied unsigned request, a cross-origin browser upload from the deployed origin, and a representative large file.

## Rollback considerations

The schema changes are additive: nullable columns and new tables. An older application can still read/write the original columns after the migrations, so do **not** drop the new columns or tables as a first rollback step. Keep `ADMIN_PASSWORD` unchanged if you need existing admin sessions and rate-limit keys to remain valid.

Rolling back application code does not make new R2 content understandable to the old code. Links stored as `r2:///...` and posters stored as `/api/image?upload=...` require the new download/image routes. If you roll back after creating R2 links, those new links will not work until you roll forward or manually replace them with legacy/external URLs. Legacy `/uploads/...`, Telegram, and external HTTP(S) links remain compatible.

Recommended rollback order:

1. Stop admin writes/uploads.
2. Back up the current database and record the deployed commit.
3. Redeploy the previous application commit without dropping schema.
4. Verify legacy movies/anime/episodes/posters/downloads.
5. If R2 links were already created, either roll forward again or replace those links deliberately. Do not delete R2 objects as part of rollback.
