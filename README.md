# Vault — Movies, Anime & Series

Existing Next.js + PostgreSQL media library with admin-managed movies, anime/series seasons, episodes, posters, and download links.

## What is supported

- Movies with separate 720p / 1080p / other-quality downloads.
- Anime and TV series with multiple seasons, batch-created episodes, and per-episode quality links.
- Complete-season archives (ZIP/RAR/7z) attached to a season.
- Private Cloudflare R2 uploads for videos, archives, and posters. Files upload directly from the browser to R2 with multipart presigned URLs; Next.js never stores the video bytes on local disk.
- Telegram links (`https://t.me/...`, `tg://...`) and other external HTTP(S)/magnet links alongside R2 files.
- Legacy `/uploads/...` database records and local files remain readable. New local uploads are disabled.
- Signed, short-lived R2 download URLs. The bucket can stay private.

## Quick start

```bash
npm ci
cp .env.example .env
# Edit .env: DATABASE_URL, ADMIN_PASSWORD, and R2_* values.
npm run db:migrate
npm run dev
```

Open `/admin` and sign in with `ADMIN_PASSWORD`. There is no default password.

## Cloudflare R2

See [docs/R2_SETUP.md](docs/R2_SETUP.md) for bucket, CORS, credentials, environment variables, and deployment notes.

## Database migrations

Migrations are explicit and additive. They do not run automatically during `dev` or `build`.

```bash
npm run db:migrate
```

`0000_existing_schema` is idempotent for the original Vault tables. `0001_r2_storage` adds R2 upload metadata, season-level links, quality, and storage-provider columns without deleting or rewriting existing records.

## Tests

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

End-to-end tests use a local PostgreSQL-compatible test database and a local S3-compatible mock. They do **not** contact Cloudflare:

```bash
# Terminal 1: test database
npx pglite-server --port 5433 --host 127.0.0.1 --max-connections 10
# Terminal 2: mock R2
node tests/mock-r2.mjs
# Terminal 3: app pointed at the test services
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/postgres \
ADMIN_PASSWORD=test-admin-password \
R2_ACCOUNT_ID=test R2_ACCESS_KEY_ID=test R2_SECRET_ACCESS_KEY=test \
R2_BUCKET_NAME=test-bucket R2_ENDPOINT=http://127.0.0.1:9000 R2_PART_SIZE_BYTES=5242880 \
npm run dev -- --hostname 0.0.0.0 --port 3001
# Terminal 4: seed legacy fixtures and run E2E
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/postgres node tests/seed-legacy.mjs
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/postgres npm run test:e2e
```

On Debian/Ubuntu, the bundled serverless Chromium may need NSS/NSPR libraries. If `npm run test:e2e` reports missing `libnspr4.so`/`libnss3.so`, install your distro's Chromium runtime dependencies or run:

```bash
LD_LIBRARY_PATH=/tmp/al2023/lib npm run test:e2e
```

after `node -e "import('@sparticuz/chromium').then(m=>m.inflate('node_modules/@sparticuz/chromium/bin/al2023.tar.br'))"` has extracted the bundled libraries.

## Maintenance

Abort expired incomplete multipart uploads (never deletes completed objects):

```bash
npm run r2:cleanup
```

## Important storage note

New uploads go to R2. Existing local `/uploads/...` files are preserved, but they still live wherever the old deployment stored them. If your host has an ephemeral filesystem, keep a persistent copy of those legacy files or re-upload them through the admin panel before relying on them. R2 objects are retained when a link/media row is deleted; remove objects separately in Cloudflare if you intentionally want to delete the file itself.
