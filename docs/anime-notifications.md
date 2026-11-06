# Following, watch statuses and in-site episode updates

## Scope

Anime/series detail pages support anonymous Follow/Unfollow, a compact Following
page, and an in-site notification bell/history. No public account is introduced.
There is no browser push, VAPID, permission request, email/SMS episode delivery,
external notification transport, or subscription storage. Existing contact-email,
Admin, R2, wallpaper, comments and download workflows are unrelated and retained.

The existing PWA manifest, icons, installation, worker registration, static cache
and offline fallback remain. Only push/notification-click worker handlers have
been removed. Updates are visible inside the website while online; there is no
promise of alerts while the website is closed or disconnected.

## Exactly one watch status

Each `(subscriber_id, media_id)` follow row has one non-null `watch_status`:

| Stored value | Label |
| --- | --- |
| `plan_to_watch` | Plan to Watch |
| `watching` | Watching |
| `continue` | Continue |
| `on_hold` | On-Hold |
| `watched` | Watched |

New follows default to Plan to Watch. Continue is manually selected, not an
inferred playback/episode-progress tracker. A database CHECK and API validation
restrict values. PATCH `/api/follows` with `{mediaId, watchStatus}` updates only
the owning subscriber's existing follow; it does not change `created_at`, create
a missing follow, reset read history or publish notifications. Repeated Follow
requests do not reset an existing status. Unfollow is a separate DELETE action.
All five statuses remain eligible for episode updates.

The single `/following` page has All plus five wrapping status filters/counts,
compact cards and a status selector. No separate status pages are created.

## Anonymous identity and security

A random 256-bit HttpOnly, SameSite=Lax browser cookie identifies the subscriber;
only its SHA-256 digest is stored. Secure cookies are used on HTTPS. This is
independent of Admin/comment sessions. Clearing site data loses this anonymous
identity; there is no account recovery or cross-device synchronization.

Follow and notification writes retain same-origin/CSRF checks and quotas. A
subscriber row lock serializes follow writes and the 500-title limit. APIs scope
all operations to the current subscriber. Inbox/follow responses are private and
no-store; service-worker API/Admin cache exclusions remain unchanged.

## Unapplied migration 0007

This PR's unapplied `0007_anime_notifications.sql` defines four new tables:
`subscribers`, `anime_follows`, `episode_publications`, `episode_notifications`.
It includes the watch-status default/check; the two push-specific tables are not
created. No separate 0008 migration is added. The 0007 snapshot matches the revised
schema; the journal entry stays at index 7. Existing earlier migrations are unchanged.

The SQL is additive: no DROP, TRUNCATE, DELETE FROM, destructive ALTER or updates
to existing content rows. It creates six cascading FKs on new tables, four explicit
indexes, and the publication function/trigger. An INSERT SELECT backfills the new
publication table, marking legacy episodes processed so they do not generate
historical notifications. A SHARE ROW EXCLUSIVE lock on `download_links` serializes
installation/backfill with link writes; publishing can briefly wait on that lock.

The temporary Preview migration hook, durable-attempt latch code, hook tests and
hook review document have been completely removed. `npm run build` is just
`next build`. There is **no automatic migration mechanism**. No claim schema is
created by application/build code. Preview/Production migration execution and deployment require a
separate authorized operation. Migration tests ran only on isolated synthetic databases.

Because 0007 was deliberately revised before application, do not apply it over a
database where the old 0007 was already recorded or modify migration history to
force it. Any disposable database with the old schema needs a separately approved
recreation or reconciliation; no reset/migration is part of this implementation.

## Publication, fanout, deduplication and retry

The first usable link for an anime/series episode creates a publication in the
same transaction as the link. Placeholders do not publish. Additional qualities,
link edits and removing/re-adding links cannot republish an episode. Private R2
metadata remains a usable-link source without exposing a bucket or private URL.

A publication row is the durable in-site work queue. Fanout uses FOR UPDATE SKIP
LOCKED and pages of 500 recipients. Eligibility compares follow/publication
creation timestamps inside PostgreSQL, preserving microsecond precision. The
unique `(subscriber_id, episode_id)` notification rows form the durable cursor;
no OFFSET or independently advanced recipient checkpoint is used.

Each page's notification inserts and completion checkpoint commit atomically.
A failed page rolls back, retaining earlier committed pages; retry selects only
missing recipients. A publication becomes processed only when no eligible
recipient remains. Concurrent workers yield/recheck when another worker holds
the only pending publication instead of declaring the queue empty. Work is
bounded by an approximately 18-second deadline and 20 batches per invocation;
unprocessed publications survive deadline/batch exhaustion and process failure.

Publication routes schedule best-effort processing after the response. Online
visits also resume pending work, with updates refreshed on focus/visibility and
approximately every minute while visible. These are not external notifications.
The authenticated internal retry endpoint remains for durable queue recovery:
GET `/api/internal/notifications` requires an existing >=32-character CRON_SECRET;
Admin-authenticated same-origin POST `{}` resumes the same queue. Neither route
creates arbitrary publications or sends external messages. Responses report
`notifications` and `pending`, not push delivery state. There is no push-job retry
or `retryFailed` mechanism anymore.

This PR declares a daily internal retry cron in `vercel.json`; the declaration
was retained during the in-site-only simplification. No Vercel project or environment
settings were changed during verification. Preview does not receive Vercel Production cron scheduling.
Without an authorized scheduler, delayed work may resume on a later online visit
or authorized internal retry. Timely unattended recovery is not guaranteed by
visitor traffic or daily scheduling alone.

## Verification results

The approved isolated PostgreSQL 16.14 and browser verification completed on
2026-11-06. See [the consolidated report](pr7-verification-report-2026-11-06.md)
for provenance and limitations.

- Legacy migration upgrade and genuine staged 0006 → 0007 upgrade: **PASS**,
  including existing-row preservation, status CHECK/default validation, legacy
  backfill without historical alerts, and no-op migration reruns.
- Real PostgreSQL fanout: **PASS**, including exact 500/1000 boundaries, 1501
  recipients, deterministic overlapping 511 workers, page-two SQL rollback/retry,
  exactly-once notification rows, budgets/deadlines and microsecond eligibility.
- Application regression E2E: **PASS**, including Admin, comments, nested replies,
  moderation, contact, private mock R2 uploads/downloads, ranges/batches/qualities,
  legacy content, search and responsive UI.
- Notification API/browser E2E: **PASS**, including five statuses, subscriber
  isolation, follow/unfollow, deduplication, 511 recipients, scoped read history,
  bell-to-episode navigation and 360/390/768/1280px layouts.
- Production build, including TypeScript checking: **PASS**.
- Production-mode PWA smoke: **PASS**, including manifest/icons, worker
  registration/update, static-only caching, API/Admin cache exclusions and offline
  fallback. This is browser automation, not physical Android installation testing.

Earlier database-free checks passed 59/59 units, standalone typecheck/lint and the
fixture-based Following UI checks. Those fixture/unit results are separate from
the later real database/API/browser evidence. Standalone unit/lint/typecheck
commands were not repeated during the final remaining-only integration pass.

The successful integration run used a verified private jail, synthetic databases
and local R2/Resend mocks. Optional tool IPC and Next.js version/upgrade checks
were suppressed only in that disposable verification environment, without opening
network access or weakening the guard. No dependency transformation, jail-only
Next configuration override, runner, rootfs, log or screenshot is published in
this PR. Normal Next.js configuration/dependencies are preserved.

No Production/Preview database or real provider was accessed. Before applying
0007 to Preview, separately verify its migration history and ensure the older
0007 variant has not already been applied. Never rewrite history to force this
revised migration. This report does not authorize deployment or merging.

## Included regression tests

- `tests/migration-upgrade.mjs`: legacy preservation, new tables, status validation,
  backfill and reruns; no push tables.
- `tests/staged-0006-upgrade.mjs` and
  `tests/fixtures/migrations-0000-0006.json`: genuine Drizzle 0000–0006 history,
  0007-only upgrade, row/schema/history preservation and reruns. The test is
  self-contained and retains its strict namespace/attestation and synthetic-target
  checks; it requires a verified isolated runner and is not a Preview/Production
  migration command.
- `tests/watch-status.test.ts`: status labels, schema/snapshot/DDL consistency,
  follow route validation/isolation and absence of push/automatic migrations.
- `tests/notification-fanout.test.ts` and
  `tests/notification-fanout-integration.mjs`: protocol-fake and real PostgreSQL
  batching/concurrency/failure/retry coverage respectively.
- `tests/notifications-e2e.mjs`, `tests/run-e2e.mjs`: real notification/API/browser
  workflows using synthetic local services.
- `tests/pwa-service-worker.test.ts`, `tests/pwa-smoke.mjs`: simulated worker and
  production-browser PWA checks respectively.
- `tests/following-ui.mjs`: static-build/in-memory-API fixture browser checks;
  `npm run test:following-ui` requires a successful build and is not database
  integration evidence.

Push-specific UI, API, crypto/transport helpers, delivery tables, dependencies,
environment settings, worker handlers and push-only tests have been removed.
The application contains no permission request, external episode-delivery channel
or automatic migration hook. Disposable verification tooling and evidence remain
local and are deliberately excluded from the commit.
