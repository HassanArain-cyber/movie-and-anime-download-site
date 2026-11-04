# Followed anime/series and episode notifications

## Scope and release safety

This is an additive feature on top of the existing Next.js App Router, PostgreSQL/Drizzle, password-protected Admin and vanilla PWA worker. No public login, Firebase, paid notification service, R2/public-bucket change, wallpaper change or comment-session change is introduced. `web-push` implements standard VAPID and encrypted Web Push. A browser vendor's free push endpoint is the transport, including Chromium's FCM endpoint; this does **not** require a Firebase project or Firebase SDK.

This branch does not merge or deploy production, apply a remote migration, configure remote secrets or send a real device push. A normal branch push may cause the repository's existing Vercel **Preview** automation. Production release remains an operator decision.

## User workflow

1. Open any **anime or series** detail and select **Follow**. The state and follower count update. Repeat clicks/retries cannot duplicate a follow.
2. **Following** lists up to 500 saved titles in this browser, with detail links, unfollow controls and a new-episode indicator. Movies deliberately have no Follow control.
3. **Following → Notification preferences → Enable browser push** explicitly requests browser permission. Loading a page or following a title never requests it.
4. Publishing an episode's **first usable episode-level download link** creates a durable publication event. An empty episode/season/placeholder, a media/season-level link, another quality, a link edit, or deletion/re-addition does not republish it.
5. The notification bell shows unread count and recent alerts. **All notifications** provides a bounded, paginated history, individual read-on-click and mark-all-read. Each alert includes real title, season, episode number/title and the exact detail-page `#episode-ID` link. Opening that link also expands the episode and its season.
6. Disabling push revokes the server subscription before browser unsubscribe. It does not unregister the PWA, unfollow titles, or erase notification history. Unfollowing blocks future alerts and cancels queued push for the title; existing history remains.

### Anonymous identity / privacy

`vault_subscriber` is a separate, host-only, HttpOnly, SameSite=Lax cookie, Secure in production, with a one-year lifetime. Its 256-bit random bearer value is never returned in JSON; only its domain-separated SHA-256 digest is persisted. It does not reuse or change comment/admin cookies. Browser Web Locks serialize first-load initialization in supporting browsers. No email, name, public account or device fingerprint is collected. This is browser-local identity, not cross-device synchronization or recoverable account storage: clearing site data, private browsing, expiry or changing browser/origin loses access to those follows/history. Shared-browser users share the same identity.

Subscriber APIs scope every operation to that cookie and reject cross-site origins. Mutation JSON bodies and encryption keys are validated/bounded; database-backed quotas apply (240 reads / 10 minutes, 120 general mutations / 10 minutes, 20 push changes / 10 minutes). Initial identities are limited to 30/hour per trusted IP and 2,000/hour globally. IP quota keys are HMACs, not raw IPs. The existing trusted-IP-header configuration is reused; do not trust a spoofable client-supplied forwarding header. There is a 500-title/browser cap.

All inbox/follow/preferences responses are private/no-store. Push endpoints/keys are AES-256-GCM encrypted at rest with a versioned authenticated envelope; an endpoint digest enforces uniqueness. Only the owning identity can disable/update it; another identity cannot claim the same endpoint. No endpoint, browser auth key, private VAPID key, subscriber cookie, provider response body or ciphertext is returned/logged. The public VAPID key is intentionally public. Endpoint validation permits HTTPS/standard port only for the supported Chromium, Mozilla, Apple and Windows browser push services; it rejects arbitrary/private endpoints, credentials, fragments and malformed P-256 points, preventing this public API from becoming an SSRF proxy.

## Required configuration

In-site follows/notifications need the existing `DATABASE_URL` and `ADMIN_PASSWORD` (at least eight characters), plus migration `0007`. Push is optional: missing/invalid push configuration disables its Enable control, **not** in-site history. See `.env.example`.

Generate a VAPID pair once, locally:

```sh
npx web-push generate-vapid-keys --json
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Set **server-only** environment variables (never `NEXT_PUBLIC_`):

| Variable | Value |
| --- | --- |
| `WEB_PUSH_PUBLIC_KEY` | Generated `publicKey` (returned by the private configuration API for PushManager) |
| `WEB_PUSH_PRIVATE_KEY` | Matching generated `privateKey`; only the server uses it |
| `WEB_PUSH_SUBJECT` | Your real `mailto:owner@domain` or HTTPS contact URL |
| `PUSH_SUBSCRIPTION_SECRET` | Second command's output: exactly 32 random bytes, canonical base64 |
| `CRON_SECRET` | Third command's output: at least 32 random characters |
| `NOTIFICATION_RATE_LIMIT_SECRET` | Optional independent random HMAC key; otherwise existing `ADMIN_PASSWORD` |

Keep these stable across serverless instances/redeployments. Validate configuration with a matching VAPID pair, not just syntactically similar keys. Do not commit generated secrets. Keep Preview and Production database/keys isolated. Set the existing `APP_ORIGIN` to the real public HTTPS origin if required by your reverse proxy.

After review, apply to the **intended** database before releasing code:

```sh
npm ci
npm run db:migrate
npm run build
```

`0007_anime_notifications.sql` creates six new tables and indexes, backfills **already published** episodes as processed (no historical spam), and installs a first-link INSERT/UPDATE trigger on `download_links`. It does not rewrite existing media, episodes, links, uploads, settings, comments or storage. Installation locks link writes briefly to serialize backfill/trigger creation; schedule a low-traffic migration. Drizzle's migration transaction keeps it atomic. Do not use `db:push`, re-run individual SQL fragments or change old migrations. The generated schema snapshot/journal accompany the migration.

### Publication, fanout and delivery architecture

- The tiny database trigger writes one publication marker per episode, in the same transaction as its first usable link. It snapshots the title/episode metadata and relative episode URL. It never calls a network service or fans out to followers. Existing external HTTP(S), Telegram/magnet, legacy upload and valid attached private-R2 links are supported. R2 multipart completion alone is not publication: the existing validated attachment route must save the episode link.
- Existing link POST/PATCH responses schedule a best-effort `next/server after()` worker. Publication returns without waiting for network delivery. Regular `/api/updates` traffic also resumes pending work after its response.
- Durable worker transactions claim one publication page with `FOR UPDATE SKIP LOCKED`, insert up to 500 recipients, and atomically commit its notifications/push jobs. Each invocation drains up to 20 pages within the shared deadline, resuming remaining work on later invocations. Committed notification rows are the durable pagination checkpoint (no OFFSET or separately advanced cursor). An empty locked selection is rechecked against pending events with a bounded 25–250ms yield; it is not mistaken for an empty queue. Completion explicitly verifies that no eligible follower is missing, including exact 500/1000 boundaries. Eligibility stays in PostgreSQL to preserve microseconds. Only titles followed **before publication** qualify; following a title later never generates historical alerts. An unfollow/re-follow has a new follow timestamp.
- Notification uniqueness is `(subscriber_id, episode_id)`. Notification creation and eligible push-job insertion commit together. Push requires a subscription enabled before the publication, so enabling push never blasts old unread alerts.
- Unique `(notification_id, subscription_id)` jobs use database leases with random ownership tokens; a crashed worker's lease expires after two minutes. Up to ten deliveries run concurrently with eight-second transport timeouts, bounded to 200 attempts and an approximately 18-second processing budget per invocation (an in-progress batch can extend that by up to eight seconds). Routes allow 30 seconds. Unfinished work stays durable.
- `404/410` deletes the exact expired subscription and its jobs. Network errors, `408`, `429` and `5xx` retry with delays 30, 60, 120, 240, 480, 960, 1920 seconds, capped at one hour; stop after eight attempts. Other `4xx` become failed jobs for explicit repair/retry. Disable removes jobs; unfollow cancels queued jobs and delivery rechecks ownership/follow immediately before sending. A request already handed to a push provider cannot be recalled.
- Publishing/adding another quality cannot duplicate in-site notifications or jobs. **Exactly-once delivery over an external network is impossible** after an ambiguous timeout/crash following successful provider acceptance. Retries are at-least-once in that case. A stable provider Topic and service-worker notification tag/`renotify:false` collapse outstanding repeats; do not claim that every OS can never redisplay a previously dismissed notification.
- Worker diagnostics contain only safe codes. No push transport details are exposed to anonymous callers. Old expired rate-limit buckets are removed in bounded batches.

### Automatic retries / free scheduling

`vercel.json` adds one daily cron at `00:00 UTC`, compatible with the daily Hobby scheduling restriction. Vercel production cron supplies `Authorization: Bearer $CRON_SECRET`. Preview deployments do **not** get scheduled cron. The route fails closed if the secret is missing/too short. Normal first delivery runs automatically after publication; the daily cron is a durable safety net, **not** a promise of minute-level background retry latency.

For prompt unattended recovery or larger backlogs, configure an existing trusted/free scheduler to call this authenticated endpoint every few minutes. No paid push service or Vercel plan upgrade is required by the implementation, but deployment/provider quotas still apply. A daily-only cron can be insufficient for a large backlog: each invocation is deliberately bounded. In-site visits also drain work, but do not substitute visitor traffic for a reliable scheduler when timely recovery matters.

```sh
curl --fail --silent --show-error \
  -H "Authorization: Bearer $CRON_SECRET" \
  "https://YOUR-HOST/api/internal/notifications"
```

The JSON reports created notifications, delivery attempts and configuration/backlog status. Pending jobs with a future retry time are **not** immediately eligible; do not tight-loop to bypass backoff. No public/manual initial-notify action exists. The password-authenticated, same-origin Admin session can POST `{}` to the same route to resume work; after fixing configuration it can POST `{"retryFailed":true}` to requeue at most 200 terminal failures. This retries existing jobs, not creating new notifications. It never restores disabled/expired subscriptions. Diagnose aggregate state privately with `SELECT state, count(*) FROM push_deliveries GROUP BY state;`—do not expose subscription tables or job logs publicly.

If VAPID keys or the subscription-encryption secret are rotated/lost, existing browser subscriptions may require **Repair browser subscription** (or Disable then Enable). Keep backups of the stable secrets. A key change is not a reason to erase follows/history. Do not run the test transport preload or set its test flags in a deployed environment.

## Browser and PWA limits

Use HTTPS (loopback is a development exception). Supported Android Chrome/Firefox browsers can receive standard Web Push while the site is closed; no open tab is required. The browser/OS push service must still be running and connected. Browser force-stop, disabled notifications, battery/data restrictions, power-off and vendor delays can prevent or delay receipt. On iOS/iPadOS 16.4+, Web Push requires the installed Home Screen web app and a permission gesture. Desktop support varies. No paid service can remove those platform limits.

The existing `public/sw.js` install/activate/fetch handlers, cache version, static/offline cache, API/admin exclusions, manifest, icons and production registration remain intact; push and notification-click handlers are appended. A push click validates a same-origin anime/series episode URL, marks only the current browser's notification read, navigates/focuses a public tab or opens one, and leaves an Admin editing tab intact. Offline clicks still use the existing offline fallback. No notification permission prompt is triggered by installation.

## Verification (2026-11-04)

- `npm run typecheck`: PASS.
- `npm run lint`: PASS.
- `npm test`: **54/54 PASS** (48 existing + six notification tests). New tests validate service-host/P-256 rejection, authenticated subscription encryption/tampering, matching key configuration, real `aes128gcm` encrypt/decrypt and ES256 VAPID signature/audience, bounded retry policy and SW display/click/cache-handler preservation.
- Fresh disposable **real PostgreSQL** migration upgrade + repeat migration: PASS. Legacy rows/URLs remain unchanged; all new tables exist; legacy publication is processed without notifications.
- `npm run test:e2e:ci`: PASS, including the complete prior browser/API/R2/contact/comments/admin suite and new `tests/notifications-e2e.mjs`. A deterministic real-PostgreSQL fanout regression also covers 500/1000 exact boundaries, 1501 recipients, overlapping workers holding the first 500-row transaction, actual page-two SQL failure/rollback followed by retry (notifications and push jobs), bounded-work/deadline recovery, and sub-millisecond eligibility. The original 511-follower assertion remains and additionally verifies distinct recipients and zero omitted eligible follows. New suite covers secure independent identities, persisted/concurrent follows, CSRF and ownership, first-link/placeholder/second-quality/edit/removal/re-add/concurrent dedup, repaired invalid link and private-R2 marker, 511-follower resumed fanout, paginated/read history, real encrypted push request intercepted only at the test transport, 503 retry, concurrent workers, live/expired crash-lease recovery, queued unfollow cancellation, 410 cleanup, final-failure Admin replay, push-disable/history and unfollow, anime and series, explicit-click-only permission, browser bell → expanded exact episode, and 360/390/768/1280px no-overflow checks.
- `npm run build`: PASS (production compilation, TypeScript and static generation).
- `PWA_BASE_URL=http://127.0.0.1:3000 npm run test:pwa` against `next start`: PASS. Manifest/installability, icons, SW activation/update, static-only caching, subscriber/auth API cache exclusion, Admin online and offline fallback retained.
- `npm audit --omit=dev --audit-level=high`: zero production vulnerabilities. `npm audit --audit-level=high`: PASS threshold; 20 development-tool moderate advisories remain. No forced/breaking unrelated dependency update was made.

Tests refuse remote database/app targets. The runner generates disposable VAPID/encryption/cron secrets and intercepts only its named fake FCM endpoint through a Node test preload: validation, signing, payload encryption, job creation and failure handling remain real. Browser permission/PushManager are mocked to test the gesture and UI, not to claim a headless browser enrolled with an actual vendor. Unit SW handlers execute in a simulated worker. **Physical Android closed-browser receipt, real vendor acceptance and real device notification tap remain a manual acceptance test** after authorized HTTPS/key setup. Nothing was sent to a real push endpoint.

Manual acceptance: on a supported Android device follow a title → Enable browser push → close the site → publish one placeholder (no alert) → attach its first link (one OS alert/in-site unread) → tap it (correct expanded episode/read state) → add another quality (no new alert) → unfollow (future episode silent) → re-follow, disable push and publish (in-site alert only, history retained). Repeat on desktop; verify denied/unsupported permission states and OS restrictions honestly.

## PR #7 fanout failure investigation

The CI failure at 500/511 was reproduced against the original code with a deliberately held first-page transaction: both retry invocations returned `[0, 0]` because `SKIP LOCKED` skipped the only pending event; the first invocation then committed 500 and stopped. The event remained unprocessed, so these were durable queued recipients, not lost rows, but no invocation continued to the remaining 11 before the assertion. Increasing a limit or sleeping in/weakening the E2E test would hide this race, not fix it. The implementation now drains multiple committed pages and cooperates with locked work within its bounded deadline. No migration or duplicate-prevention relaxation was required.

Each page retains the publication row lock until notification, outbox and completion changes commit together. A real PostgreSQL division-by-zero injected on page two proves its inserts roll back while page one's 500 notifications/jobs remain committed; retry creates only the remaining 501 of 1001. Tests also verify exact boundaries, 1501 recipients, two overlapping retry workers, deadline/batch exhaustion and precise timestamp eligibility. The existing encrypted-push retry, crash lease, expired subscription, unfollow and browser/API regressions are still executed unchanged.
