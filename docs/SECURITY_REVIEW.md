# Authentication and R2 security review

This review covers the admin session/login API, admin mutation endpoints, R2 upload/download paths, and the CI test harness. It was performed alongside the R2 integration; no production database or real R2 bucket was contacted.

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

**Fix:** refresh/complete/recovery/abort/link-attachment now enforce the configured bucket and active expiry where appropriate. Abort and failed-upload recovery claim a transition status atomically before touching R2. Cleanup also handles interrupted `aborting` sessions. Completed objects are still never auto-deleted.

**Tests:** E2E expired-session refresh/complete rejection, wrong-bucket refresh/complete/abort/attachment rejection, transition-lock rejection, and cleanup-script compatibility.

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

**Fix:** new poster/thumbnail values must be public HTTP(S), legacy `/uploads/...`, or a valid `/api/image?upload=<uuid>` reference. Script/data schemes, credentials, loopback, link-local, and private IP literals are rejected. Existing records are not rewritten.

**Tests:** unit URL cases; E2E create/update rejection for script and metadata/private URLs.

### 7. R2 endpoint override allowed insecure non-loopback HTTP and extra URL components

**Risk:** accidental credential-bearing requests over plaintext HTTP or malformed endpoints.

**Fix:** `R2_ENDPOINT` must be HTTPS, except HTTP loopback for local tests. Credentials, paths, queries, and fragments are rejected.

**Tests:** unit endpoint validation; E2E uses the loopback mock endpoint.

### 8. Error/auth responses and browser hardening headers were inconsistent

**Fix:** API errors and auth/session responses use `no-store`; global `nosniff`, `X-Frame-Options: DENY`, referrer policy, and permissions policy headers were added. Category endpoints now use the same validated JSON/error path as the rest of the admin API.

**Tests:** E2E header and category-validation assertions.

## Remaining deployment responsibilities

- Use a long random `ADMIN_PASSWORD`; there is no default. Rotating it invalidates existing sessions and rate-limit HMAC keys.
- Set `APP_ORIGIN` and, if appropriate, `ADMIN_LOGIN_TRUSTED_IP_HEADER` for your exact proxy topology. Do not trust arbitrary `X-Forwarded-For` from the public internet.
- Keep the R2 bucket private, scope credentials to the bucket, and configure CORS for the deployed origin. Presigned URLs are bearer credentials for their method/key/time window; keep TTLs short and do not log them.
- Run `npm run db:migrate` explicitly after backup. The new migration is additive and idempotent.
- The E2E mock verifies presigned signatures but does not implement Cloudflare IAM, real CORS, or large-file behavior. Verify a small real upload/download after deployment.
- Legacy `/uploads/...` files are preserved but are not automatically moved to R2.
