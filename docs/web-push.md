# Optional background Web Push — PR #33

## Behavior
- Existing in-site notification bell, Follow statuses, admin/content, R2 and comments remain unchanged.
- Push is optional and requires explicit user consent; it can wake a supported PWA service worker while the website is closed.
- New deliveries are created only for newly generated in-site episode notifications if the browser subscription already existed. Migration does not push old alerts.
- Device subscriptions are scoped to existing anonymous HttpOnly subscriber identity. Opt-out removes the server record and calls browser unsubscribe.
- Stale device endpoints (404/410) are deleted; retries are bounded and use short database leases.
- Stable notification tags reduce duplicates, but exactly-once browser delivery cannot be guaranteed on ambiguous network failure.

## Deployment prerequisites (do not modify Production until tested)
1. Back up Neon Production and separately apply additive migration `0012_web_push.sql` after reviewing the SQL.
2. Generate a VAPID P-256 key pair with the pinned `web-push` library. Never commit the private key or browser subscription endpoints.
3. Configure `PUSH_VAPID_PUBLIC_KEY`, `PUSH_VAPID_PRIVATE_KEY` and `PUSH_VAPID_SUBJECT` (an HTTPS contact URL or mailto address) in Vercel's server-side environment.
4. Deploy Preview, opt in on a real browser/Android PWA, trigger a newly published test episode on disposable data, and confirm click navigation and unsubscribe.
5. After CI and real-device verification, approve and run the Production migration, deploy, and verify real subscribed devices.

## Security
- Subscription endpoint hosts are strictly limited to recognized push services to prevent arbitrary server fetches.
- Input is capped and validated (HTTPS endpoint, 65-byte uncompressed P-256 public encryption key, 16-byte auth secret).
- Public GET exposes at most the VAPID public key; private keys and endpoint capabilities are server-only.
- Same-origin mutation checks, anonymous session authorization, DB-backed rate limiting, and a five-device-per-subscriber limit apply.
- Database access to push endpoints must remain restricted and backups secured. Provider error objects are never logged.
- Missing migration or credentials leave existing in-site notifications operational.

## Free hosting and timing limitations
- Push transport uses the free `web-push` library; it is not a paid notification API.
- The existing daily Vercel cron remains unchanged. On Vercel Hobby, daily recovery cannot guarantee minute-level unattended delivery.
- Publication and online visits attempt best-effort push delivery promptly; service-worker background delivery depends on the browser, network and OS.
- On iOS, Web Push generally requires the web app installed on the Home Screen.

## Required tests
- Typecheck, ESLint, dependency audits, migration idempotency and preservation, all unit tests, browser/API E2E and PWA cache/privacy checks.
- Explicit real-provider/real-device acceptance testing is separate; a ready preview alone cannot prove closed-app delivery.
