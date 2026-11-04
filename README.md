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
- Smart live search supports title aliases/acronyms, typo-tolerant matches, episode-title hits, ranking, deduplication, and strict Movies/Anime/Series filters, with separate responsive title/episode cards and direct episode anchors.
- Anonymous community discussions for movies, anime, series, and individual episodes: unlimited nested replies, session-unique likes/reports, spoiler reveal controls, server-side moderation, and per-title/episode comment settings.
- Installable PWA with Android/desktop standalone metadata, app icons, an offline fallback, and a service worker that caches only hashed static assets/icons—not pages, API responses, authentication, or admin data.
- A mobile-friendly Request form stores submissions in PostgreSQL. Admins can review and delete requests in the Requests section; submitting never opens an external app.

## Smart search

The Navbar suggestion endpoint and submitted search results share the same bounded matcher. It normalizes text, expands the editable alias map in `src/lib/search.ts` (for example JJK, DBZ, SAO, AOT, and MHA), ranks exact matches ahead of aliases and fuzzy matches, and searches anime/series episode titles while returning the matching parent title and episode context. The selected content type and tag filter are applied on both suggestions and result pages. No search index or database migration is required.

## Community comments

Each movie/anime/series page has a title-level discussion, and each episode has a separate discussion beneath its episode downloads. Anonymous commenters can reply to **any comment or reply at any depth** using the inline reply composer, like once per signed HttpOnly session, mark spoilers (hidden until “Show Spoiler”), and report a comment once per session. Replies are stored in the existing `comments.parent_id` self-referencing column; there is no depth limit and no extra migration. The API walks the full ancestor chain, so hiding a comment hides its entire subtree, and likes/reports cannot target anything below a hidden ancestor. The UI renders a real nested tree, indenting each level on desktop while capping visual indentation on narrow mobile screens (deeper replies show their level in a badge) so long threads never overflow horizontally. Action bars use consistently sized, accessible icons with tooltips—thumbs-up with the like count, reply, and flag—and metadata is only a subtle compact timestamp with no author label. Current-year comments show `Nov 4 · 9:45 AM`; older comments keep the four-digit year, for example `Nov 4, 2026 · 9:45 AM`. The year comparison is dynamic and uses the viewer's timezone.

Only plain text is accepted; HTML-like tags and control/bidi characters are rejected or normalized. The public API never returns author/session hashes or personal contact fields. PostgreSQL-backed session/client rate limits, duplicate-post checks, a honeypot, body limits, and same-origin checks reduce spam and cross-site submissions. Replies must belong to the same title/episode discussion and must not target a hidden or missing parent.

Admins can browse all comments or review pending/reviewed/resolved reports under **Comment moderation**, see each reply's nesting level, hide/restore content (which hides/restores the whole subtree), and permanently delete comments (with confirmation; replies at every depth, likes, and reports cascade through the self-FK). In **Media**, title settings enable/disable the full item's discussions and an individual episode checkbox controls that episode's discussion. Disabling new comments leaves existing discussions readable. The rules shown to commenters prohibit harassment, spam, illegal links, and personal information. Anonymous session cookies use `COMMENT_SESSION_SECRET` when configured, otherwise `ADMIN_PASSWORD`; the limiter uses `COMMENT_RATE_LIMIT_SECRET`, then `CONTACT_RATE_LIMIT_SECRET`, then `ADMIN_PASSWORD`. Optional `COMMENT_RATE_LIMIT_WINDOW_SECONDS` (default 600), `COMMENT_RATE_LIMIT_MAX_ATTEMPTS` (10/session/window), and `COMMENT_RATE_LIMIT_CLIENT_MAX_ATTEMPTS` (40/trusted client/window) tune limits.

## Installable PWA

Vault includes a Web App Manifest, 192/512px app icons (including maskable), Apple touch icon metadata, dark theme/background colors, standalone display mode, and a root-scoped service worker. The worker caches only versioned Next.js static assets, app icons, and the offline fallback. It always uses the network for page navigations and does not intercept `/api`, authentication, or admin requests, so offline data cannot become stale or bypass session checks. Offline navigation displays a generic connection message rather than cached library/private content. When changing cached assets, bump the `STATIC_CACHE` version in `public/sw.js`; activation removes older Vault cache versions.

On supported HTTPS browsers (including Vercel Preview), use the browser’s **Install App** option. Android uses the manifest’s install/splash colors and maskable icon; desktop Chrome/Edge use the same standalone launch metadata. PWA smoke tests run against a production build at `PWA_BASE_URL` (default `http://127.0.0.1:3000`):

```bash
# Terminal 1: disposable local database
npx pglite-server --port 5433 --host 127.0.0.1 --max-connections 8
# Terminal 2: migrate, build, and serve the production bundle on loopback
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/postgres npm run db:migrate
npm run build
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/postgres ADMIN_PASSWORD=test-password npm run start -- --hostname 127.0.0.1 --port 3000
# Terminal 3: inspect installability, cache/privacy, update, and offline behavior
PWA_BASE_URL=http://127.0.0.1:3000 npm run test:pwa
```

The smoke test verifies Chromium installability, manifest/icon validity, start URL, worker activation/update behavior, offline fallback, and that auth/API responses are not cached. Real Android-device installation still depends on the device/browser’s own install UI.

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

Unlimited nested replies reuse the `comments.parent_id` column, `comments_parent_id_idx` index, and `comments_parent_id_comments_id_fk` self-FK introduced in `0006_comments`; **no additional migration is needed** for this feature. The API and UI derive depth from the parent chain instead of adding a depth column.

`0000_existing_schema` is idempotent for the original Vault tables. `0001_r2_storage` adds R2 upload metadata, season-level links, quality, and storage-provider columns without deleting or rewriting existing records. `0002_auth_rate_limits` adds shared login-attempt counters keyed by HMAC, not raw IP addresses. `0003_upload_operation_lease` adds nullable lease columns used to recover crashed upload completion/abort operations. `0004_site_wallpaper` adds the additive `site_settings` table; existing media, seasons, episodes, and download links are retained. `0005_contact_requests` adds a `contact_requests` table for form submissions without modifying existing records. `0006_comments` adds comment enable flags to media/episodes and anonymous comments, likes, and report tables; existing content is retained.

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
