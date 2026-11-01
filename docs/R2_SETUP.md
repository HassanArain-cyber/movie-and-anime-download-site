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
    "AllowedMethods": ["GET", "HEAD", "PUT", "POST", "DELETE"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag", "Content-Length"],
    "MaxAgeSeconds": 3600
  }
]
```

The browser uploads parts with `PUT`. Downloads are ordinary navigations/redirects to signed R2 URLs, so they do not require CORS. Do not use `*` for a production admin origin unless you intentionally accept any site.

## 4. Environment variables

Set these on the server/hosting platform, not in client-side code:

```dotenv
DATABASE_URL=postgresql://...
ADMIN_PASSWORD=use-a-long-random-password

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

`R2_PART_SIZE_BYTES` must be at least 5 MiB. The app automatically increases part size for very large files so the 10,000-part limit is respected. Video/archive uploads default to a 10 GiB per-file limit; images default to 10 MiB.

## 5. Migrate and deploy

```bash
npm ci
npm run db:migrate
npm run build
npm start
```

Back up the database before migrating. The migration is additive and does not rewrite existing URLs. The app does not auto-migrate on startup.

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

The cleanup script aborts only expired pending uploads recorded in `r2_uploads`. It never deletes completed objects. Deleting a download link, episode, season, or media row in the admin panel also does not delete R2 objects.

## Legacy local files

Existing `/uploads/...` links still work through `/api/download` if the files exist under `public/uploads` on the server. New uploads no longer write there. If your deployment filesystem is ephemeral, preserve legacy files on persistent storage or re-upload them through the admin panel. The app does not silently delete or move old files.

## Security notes

- Keep the bucket private. Video/archive downloads use signed GET URLs.
- Posters use `/api/image?upload=...`, which redirects to a signed image URL. Only completed image uploads are exposed there.
- `ADMIN_PASSWORD` is required and must be at least 8 characters. The old `admin123` default is removed.
- External links are restricted to HTTP(S), Telegram (`tg:`), and magnet URLs. `javascript:`/`data:` links are not rendered as clickable downloads.
- Local legacy downloads are path-contained and must correspond to a recorded database URL.
