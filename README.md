# Vault — Movies, Anime & Series

Existing Next.js + PostgreSQL media library with admin-managed movies, anime/series seasons, episodes, posters, and download links.

## What is supported

- Movies and episodes with multiple independent download versions (360p through 8K, plus custom/other), each with its own label, file size, and URL or private R2 object.
- Anime and TV series with multiple seasons, batch-created episodes, and per-episode quality links.
- Public episode lists keep individual download buttons and add checkboxes, Select All/Clear Selection, per-quality bulk selection, and an individual-file download queue that reports completed handoffs, waiting, skipped, and failed items (the browser owns transfer progress). The browser manages the actual transfer progress; complete-season archives remain available as before.
- Complete-season archives (ZIP/RAR/7z) attached to a season.
- Private Cloudflare R2 uploads for videos, archives, and posters. Files upload directly from the browser to R2 with multipart presigned URLs; Next.js never stores the video bytes on local disk.
- Telegram links (`https://t.me/...`, `tg://...`) and other external HTTP(S)/magnet links alongside R2 files.
- Legacy `/uploads/...` database records and local files remain readable. New local uploads are disabled.
- Signed, short-lived R2 download URLs. The bucket can stay private.
- Admin-managed site wallpaper: upload to private R2 or select an existing media poster/thumbnail, preview, apply/replace, and remove. Public rendering uses the existing signed image route with a readability overlay; clearing the setting does not delete the R2 object.
- A mobile-friendly Request form stores submissions in PostgreSQL. Admins can review and delete requests in the Requests section; submitting never opens an external app.

## Quick start

```bash
npm ci
cp .env.example .env
# Edit .env: DATABASE_URL, ADMIN_PASSWORD, ADMIN_EMAIL, RESEND_API_KEY,
# RESEND_FROM_EMAIL, and R2_* values.
npm run db:migrate
npm run dev
```

Open `/admin` and sign in with `ADMIN_PASSWORD`. There is no default password.

## Contact requests

Public Request submissions are validated and normalized on the server, protected by same-origin checks and a hidden honeypot, then saved to the `contact_requests` PostgreSQL table before a notification is sent server-to-server through Resend. The database is the source of truth: a failed email never removes a saved request, and the form confirms that the request was saved while noting if the admin email notification could not be sent. Admins can view and delete submissions in the Admin Panel’s **Requests** section; both management endpoints require admin authentication. Submitting never opens Gmail, Telegram, or another external app.

Configure `ADMIN_EMAIL` as the notification recipient, `RESEND_API_KEY` as a server-only Resend secret, and `RESEND_FROM_EMAIL` as a sender address/domain verified with Resend. Never expose these values with `NEXT_PUBLIC_` variables. The browser receives only whether the request was saved and whether the notification was sent—not the provider credentials.

Requests are rate-limited using PostgreSQL-backed counters. Defaults are five submissions per trusted client IP and 100 submissions globally per 15 minutes. Per-IP limits apply only if `ADMIN_LOGIN_TRUSTED_IP_HEADER` names a header that the trusted proxy overwrites with one client IP; otherwise the global limit still applies. Optional `CONTACT_RATE_LIMIT_*` variables tune these limits, and `CONTACT_RATE_LIMIT_SECRET` can provide a separate HMAC secret for the contact counters.

## Cloudflare R2

See [docs/R2_SETUP.md](docs/R2_SETUP.md) for bucket, CORS, credentials, environment variables, and deployment notes.

## Database migrations

Migrations are explicit and additive. They do not run automatically during `dev` or `build`.

```bash
npm run db:migrate
```

`0000_existing_schema` is idempotent for the original Vault tables. `0001_r2_storage` adds R2 upload metadata, season-level links, quality, and storage-provider columns without deleting or rewriting existing records. `0002_auth_rate_limits` adds shared login-attempt counters keyed by HMAC, not raw IP addresses. `0003_upload_operation_lease` adds nullable lease columns used to recover crashed upload completion/abort operations. `0004_site_wallpaper` adds the additive `site_settings` table; existing media, seasons, episodes, and download links are retained. `0005_contact_requests` adds a `contact_requests` table for form submissions without modifying existing records.

Back up the database before migrating. Migrations are additive and transactional, but index/constraint creation can lock tables; use a maintenance window for a large database. The disposable upgrade test creates the pre-PR schema, seeds legacy rows, migrates twice, and checks that categories/media/seasons/episodes/links are preserved:

```bash
# Against a fresh disposable loopback database, not production:
node tests/migration-upgrade.mjs
```

Rollback: redeploy the previous application commit without dropping the new columns/tables. The old schema remains compatible, but links created as `r2:///...` and posters created as `/api/image?upload=...` require the new routes. See [docs/R2_SETUP.md](docs/R2_SETUP.md#rollback-considerations).

## Tests

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

End-to-end tests use a disposable PostgreSQL-compatible test database, a local S3-compatible mock, and a local Resend stub. They do **not** contact Cloudflare or Resend. The CI runner starts/stops both mocks and the app, seeds legacy fixtures, and refuses non-loopback database/app/provider targets:

```bash
# Terminal 1: disposable test database
npx pglite-server --port 5433 --host 127.0.0.1 --max-connections 8
# Terminal 2: migrate, seed, start mock/app, run browser/API E2E, clean up
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/postgres npm run db:migrate
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/postgres npm run test:e2e:ci
```

GitHub Actions runs the same suite in the `e2e` job against a disposable PostgreSQL 16 service. Logs are uploaded as an artifact if that job fails. The mock verifies presigned SigV4 method/expiry/tampering; it is not a production S3/IAM implementation.

See [docs/SECURITY_REVIEW.md](docs/SECURITY_REVIEW.md) for the authentication/R2 review, fixes, and remaining deployment responsibilities.

## Maintenance

Abort expired incomplete multipart uploads and recover stale transition leases (never deletes completed objects):

```bash
npm run r2:cleanup
```

## Important storage note

New uploads go to R2. Existing local `/uploads/...` files are preserved, but they still live wherever the old deployment stored them. If your host has an ephemeral filesystem, keep a persistent copy of those legacy files or re-upload them through the admin panel before relying on them. R2 objects are retained when a link/media row is deleted; remove objects separately in Cloudflare if you intentionally want to delete the file itself.
