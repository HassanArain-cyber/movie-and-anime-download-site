# PR #7 notification regression: findings and safe follow-up

## Confirmed source-level cause and reproduction

The bell, Following page and detail-page Follow control all consume the same
`UpdatesProvider` bootstrap request, `GET /api/updates`. Failure leaves `data`
null and surfaces the API error in all three places. Before this fix the Follow
button was still in the DOM but disabled and labelled `Loading…` indefinitely,
while the detail page continued advertising Follow. An offline render of the
real component reproduced this before changing application source.

`src/lib/notifications/session.ts` deliberately maps unclassified database
failures to a credential-safe generic HTTP 503. A missing relation (SQLSTATE
42P01) reproduces that exact message; an incompatible column (42703), privilege
failure or connection failure can also cause bootstrap failure. The message
alone cannot establish which happened on a live deployment.

0007 creates `subscribers`, `anime_follows` (including `watch_status`),
`episode_publications` and `episode_notifications`. Bootstrap requires these
objects. `auth_rate_limits` is an earlier prerequisite. Before this fix,
bootstrap could write rate-limit rows before discovering missing 0007 objects.
The detail page intentionally tolerates a missing follows table when calculating
its optional follower count, explaining why the rest of a detail page can work.

0008 creates `content_state`. Existing `lifecycleReady`/`activeRaw` behavior
supports notification reads when 0008 is absent. Absence of 0008 alone is not a
reason to install it to repair notifications. Tests cover both lifecycle states.

## Scope of this patch

- Keep the Follow button's action label visible during initialization/outages;
  retain disabled behavior until real follow preferences are available, busy
  accessibility state and Retry. No optimistic/fake follow success.
- Read-only schema capability check before subscriber/rate-limit writes, shared
  by updates, follows and history/read-action requests. The worker also checks
  before cleanup or fanout writes. No schema creation or automatic migration.
- Missing capability returns a private/no-store HTTP 503 with a setup-specific
  message. Missing-relation/column errors, including a wrapped PostgreSQL cause,
  are distinguished from generic connectivity failures. Logs contain only safe
  fixed diagnostic identifiers/SQLSTATE, not SQL, rows or connection strings.
- No failed-readiness cache: Retry can recover immediately once the actual
  prerequisite is available. Successful API payloads and all five watch statuses
  remain unchanged. The check is not proof of the ledger, ACLs, or full schema.

## Live status: not verified

No deployment API, SQL, database connection or runtime application request was
made. In particular, `/api/updates` GET creates subscribers/rate-limit records
and schedules work, so calling it against Production is not a read-only probe.
The deployed 503's exact database cause remains unconfirmed. Neither 0007 nor
0008 can be declared applied/pending from source files, CI results, or the fact
that the disposable rehearsal workflow has not run.

## Required safe database follow-up (not performed or authorized by this patch)

1. For the affected deployment, obtain its non-secret database mapping and safe
   runtime SQLSTATE. Do not reveal/decrypt credentials or treat a source branch
   name as a database branch mapping. Do not call a mutating GET as a diagnostic.
2. An explicitly authorized operator must compare the migration ledger AND
   catalog/schema on the correctly identified target. Record 0007 and 0008
   separately. Distinguish absent migration, partial/divergent schema,
   permissions, search-path resolution and connectivity before any repair.
3. If 0007 is genuinely absent on the disposable TEST branch, use only the
   existing reviewed TEST installer after its outstanding maintenance,
   search-path and authorization approvals are genuinely resolved. This patch
   does not authorize dispatch or override those gates. Partial installations
   require investigation, not replay. Do not use generic `db:migrate` as a
   shortcut: it can apply 0008 too.
4. Treat 0008 as a separate lifecycle-feature installation decision, not a
   notification prerequisite. Any Production schema work requires separate
   explicit authorization and its own reviewed procedure; none is included here.
5. After a separately authorized repair, verify the notification API, follow /
   unfollow, all five watch statuses and bell/Following UI on the approved target.
   These are live write tests and were NOT performed here.

## Offline regression verification

`tests/notification-regression.test.ts` executes real handler/session/inbox/
worker sources with explicitly injected in-memory dependencies, renders the
real Follow/bell/Following components, and exercises real provider Retry state.
It does not import the application database module or run SQL against a server.
Coverage includes schema-unavailable fail-closed behavior before writes,
recovery, absent/present 0008 filtering, safe error diagnostics and successful
follow-status rendering. Network-disabled unit-suite execution is used as an
additional guard. It is not a substitute for live API/database verification.
