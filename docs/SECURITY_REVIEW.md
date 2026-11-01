# Authentication and R2 security review

This review covers the admin session/login API, admin mutation endpoints, R2 upload/download paths, and the CI test harness. It was performed alongside the R2 integration and repeated as a final pre-merge review of the complete PR diff. No production database or real R2 bucket was contacted.

## Findings and fixes

### 1. Admin login had no rate limit

**Risk:** unlimited password guessing, especially because the admin is a single shared password.

**Fix:** PostgreSQL-backed fixed-window counters in `auth_rate_limits`, updated with one atomic UPSERT so parallel requests and multiple app instances share the same limit. Counters are keyed by domain-separated HMACs; raw IP addresses are not stored. Every attempt is counted before password parsing/checking, including malformed JSON. The limiter fails closed with `503` if the database is unavailable.

Defaults: 5 attempts per trusted client IP and 30 global attempts per 15 minutes. `429` responses include `Retry-After` and `Cache-Control: no-store`.

**Proxy trust:** forwarded headers are ignored by default. Set `ADMIN_LOGIN_TRUSTED_IP_HEADER` only to a header your trusted proxy overwrites with a single client IP (for example `x-real-ip` or `cf-connecting-ip`). Lists/malformed values fall back to the global bucket. Without a trusted header, all clients share the global bucket.

**Tests:** unit tests for header trust/settings; E2E tests for per-IP blocking, correct-password blocking while limited, concurrent atomicity, malformed-body counting, window reset, HMAC-only storage, spoofed untrusted headers, and fail-closed database outage.

### 2. Cookie-authenticated mutations lacked explicit origin checks

**Risk:** cross-site request forgery against admin create/update/delete endpoints and login/logout.

**Fix:** `SameSite=Lax` cookies remain, and browser mutations now also reject cross-site `Origin`/`Sec-Fetch-Site`. Non-browser clients may omit these headers. Set `APP_ORIGIN` to the canonical public origin behind a proxy. JSON endpoints require `application/json` and stream bodies with a hard byte ceiling (16 KiB for login, 1 MiB elsewhere).

**Tests:** unit origin/JSON tests; E2E cross-site login/mutation/logout rejection, content-type rejection, and oversized-login rejection.

### 3. R2 upload sessions could be refreshed/completed after expiry or against another bucket

**Risk:** stale multipart sessions remaining usable; bucket configuration changes accidentally signing/attaching objects from a different bucket; abort/completion races.

**Fix:** refresh/complete/recovery/abort/link-attachment now enforce the configured bucket and active expiry where appropriate. Completion and abort claim a 10-minute database lease with a unique operation token before touching R2; status writes are fenced by that token. Stale `completing`/`aborting` leases are recoverable. Cleanup is bucket-scoped, handles expired `pending`/`failed` sessions and stale transition leases, skips active leases, and checks for a completed object before aborting. A `NoSuchUpload` abort race re-checks the object so completed bytes are retained/recovered instead of being marked aborted. Completed objects are never auto-deleted.

**Tests:** E2E expired-session refresh/complete rejection, wrong-bucket refresh/complete/abort/attachment rejection, active transition-lock rejection, stale-completing recovery, active-lease cleanup skip, expired pending/failed cleanup, completed-object recovery, and other-bucket skip.

### 4. R2 HEAD downloads were signed as GET

**Risk:** `HEAD /api/download?id=...` redirected to a GET-signed URL, which SigV4 rejects for HEAD.

**Fix:** sign `HeadObjectCommand` for HEAD and `GetObjectCommand` for GET. The mock now verifies presigned SigV4 signatures, method, expiry, and tampering.

**Tests:** E2E HEAD redirect + HEAD success, GET-signed URL rejected for HEAD, unsigned object access rejected, tampered signature rejected, and short-lived URL expiry rejected.

### 5. Download endpoint could redirect to arbitrary unrecorded URLs

**Risk:** open redirect using `/api/download?url=...`.

**Fix:** direct `url` access must match a URL already recorded in `download_links`; recorded external links still redirect. `id` and `url` cannot be supplied together. Legacy file access remains path-contained and database-recorded.

**Tests:** E2E unrecorded external URL rejection, recorded external redirect, ambiguous-parameter rejection, and legacy traversal rejection.

### 6. Poster/thumbnail URLs were not validated

**Risk:** unsafe schemes or private-network URLs reaching the image optimizer/renderer.

**Fix:** new poster/thumbnail values must be public HTTP(S), legacy `/uploads/...`, or a valid `/api/image?upload=<uuid>` reference. Script/data schemes, credentials, loopback, link-local, and private IP literals are rejected. Legacy paths are checked at multiple decoding layers for traversal. The Next.js image optimizer has no remote patterns and only allows local `/uploads/**`; external/R2 images are rendered unoptimized. Existing records are not rewritten.

**Tests:** unit URL/traversal cases; E2E create/update rejection for script and metadata/private URLs, local poster optimization, remote/metadata optimizer rejection, and encoded optimizer traversal rejection.

### 7. R2 endpoint override allowed insecure non-loopback HTTP and extra URL components

**Risk:** accidental credential-bearing requests over plaintext HTTP or malformed endpoints.

**Fix:** `R2_ENDPOINT` must be HTTPS, except HTTP loopback for local tests. Credentials, paths, queries, and fragments are rejected.

**Tests:** unit endpoint validation; E2E uses the loopback mock endpoint.

### 8. Error/auth responses and browser hardening headers were inconsistent

**Fix:** API errors and auth/session responses use `no-store`; global `nosniff`, `X-Frame-Options: DENY`, referrer policy, and permissions policy headers were added. Category endpoints now use the same validated JSON/error path as the rest of the admin API.

**Tests:** E2E header and category-validation assertions.

## Final pre-merge review additions

### 9. Production dependencies had known high/critical advisories

**Fix:** upgraded Next.js and `eslint-config-next` to 16.4.3, PostCSS to 8.5.32, and verified the transitive Sharp version. CI now fails on high/critical findings in both production-only and full dependency audits. The production audit reports zero findings. Remaining full-audit findings are moderate and development-tool-only; npm's proposed fixes are breaking downgrades and were not applied.

### 10. Legacy download edge cases could break existing files

**Fix:** the download handler uses the canonical stored URL, single-decodes legacy paths under realpath containment, supports zero-byte files, and signs HEAD separately from GET. Legacy fixtures now include a real JPEG poster, an encoded-space filename, and a zero-byte video.

**Tests:** E2E legacy download/range/HEAD, encoded path, zero-byte file, traversal rejection, and poster optimization.

### 11. Upload resume/UI races could attach the wrong target or clobber state

**Fix:** initialized/refreshed upload responses include the canonical target. The client validates kind, size, target, and quality on resume, re-uploads parts whose recorded size does not match, captures worker failures, removes abort listeners, and ignores stale aborted-upload callbacks. Batch episode rows lock episode/quality once an upload session exists; single-link quality is locked while uploading/completed/resumable.

### 12. Media type changes could hide existing seasons/episodes

**Fix:** an anime/series with seasons cannot be changed to `movie` through the API. This prevents existing season/episode downloads from becoming inaccessible without deleting records.

### 13. Rate-limit and origin configuration edge cases

**Fix:** `APP_ORIGIN` must be a bare http(s) origin. IPv6 rate-limit keys are canonicalized, including IPv4-mapped forms, and attempt counters are capped to avoid unbounded growth. The stale unused `drizzle.config.json` was removed so the environment-driven `drizzle.config.ts` is the only migration config.

## Remaining deployment responsibilities

- Use a long random `ADMIN_PASSWORD`; there is no default. Rotating it invalidates existing sessions and rate-limit HMAC keys.
- Set `APP_ORIGIN` and, if appropriate, `ADMIN_LOGIN_TRUSTED_IP_HEADER` for your exact proxy topology. Do not trust arbitrary `X-Forwarded-For` from the public internet.
- Keep the R2 bucket private, scope credentials to the bucket, and configure CORS for the deployed origin. Presigned URLs are bearer credentials for their method/key/time window; keep TTLs short and do not log them.
- Run `npm run db:migrate` explicitly after backup and restore rehearsal. Migrations are additive/idempotent, but index/constraint creation can lock tables. Roll back application code without dropping the new schema; new `r2:///` links and `/api/image` posters require the new routes.
- The E2E mock verifies presigned signatures but does not implement Cloudflare IAM, real CORS, lifecycle rules, or large-file behavior. Verify a small real upload/download, unsigned denial, deployed-origin CORS, and a representative large file before relying on it.
- Legacy `/uploads/...` files are preserved but are not automatically moved to R2. Files present under `public/uploads` remain publicly served by the web server; the private R2 guarantee applies to new R2 objects.
- The login limiter is a fixed window and includes a global bucket. A distributed flood can temporarily exhaust the global bucket; tune limits/proxy trust for the deployment and monitor 429/503 responses.
- Hostname validation for poster URLs blocks private IP literals, not DNS names that resolve privately. This is acceptable while remote image optimization is disabled and external images are rendered unoptimized; do not enable arbitrary remote optimization without egress filtering.
- Deleted links/media retain R2 objects. This is intentional for data preservation but requires periodic orphan review.
- Production-mode (`next start`) E2E and the user's real production database were not available. CI builds production mode and runs E2E in dev mode against disposable PostgreSQL 16 plus mock R2.
