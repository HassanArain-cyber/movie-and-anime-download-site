# Two remaining tasks — metadata handoff and isolated notification harness

No live API/database/browser functional verification was performed while preparing these tools. Existing confirmed facts are retained. No migration execution is authorized by this file.

## 1. Current scope: TEST + backup parent + Production reference

See `TEST-EXECUTION.md` for the exact Console/trusted-terminal workflow. The validator no longer requires types/hosts/default fields for unrelated endpoints or branches. Existing eight-branch evidence and endpoint associations remain recorded; seven exclusions remain enforced by endpoint/branch IDs. No new metadata handoff is requested.

The runtime gate uses three branch GETs plus the complete endpoint inventory. It checks TEST identity/project/parent/non-default, backup identity/project/parent, Production identity/project/root/default, target direct host/read_write type, and all pinned exclusion associations. Missing approvals and unauthorized access still stop execution. Repository approval fields stay null. Independent live API verification occurs in the authorized environment, not through another manual collection task.

Offline `--known-inventory` report now identifies only operational approvals, authorized access and explicit TEST execution authorization as pending. The reference `neon-metadata.template.json` preserves unrelated unknown values without making them prerequisites. The full offline reviewer accepts three branch objects and omitted/null non-test hosts/types.

## 2. Isolated TEST-only notification harness

Files:
- `scripts/migrations/verify-notifications-0007.mts`: future live test entry point.
- `scripts/migrations/0007-scoped-fanout.mjs`: fail-closed SQL protocol adapter for the REAL existing drainFanout algorithm.
- `scripts/migrations/0007-fixture-ui.tsx` and `0007-fixture-link.tsx`: actual FollowButton, UpdatesProvider, bell and inbox components bundled into a fixture-only loopback UI, with an explicit anchor navigation seam.
- `tests/rehearsal-handoff.test.ts`: offline metadata and scoped-adapter regressions.

### Gates and isolation

The live harness requires the explicit `--verify-isolated-notifications` flag, approved rehearsal manifest, exact pinned TEST project/branch/endpoint and the existing dedicated rehearsal secrets. It repeats the live provider gate before any DB connection. It requires installed 0007 and owner-only function/object contracts, but NEVER runs an installer/migration or grants permissions. Missing approvals or missing migration stop it.

All fixtures use new cryptographic run IDs. A single outer transaction contains the new anime, season, episode, subscribers, follow, links, publications, notifications and read transition. Nothing commits. Only the owning connection sees the rows; concurrent app/worker connections cannot see fixture data. Sequence IDs can advance even after rollback; they are never reset. Do not promise literally zero sequence effects. Existing installed triggers must pass object verification first.

The real drainFanout algorithm executes through an exact-statement allowlist: global event selection and pending probes are rewritten to the fixture episode; insert/update operations additionally bind the fixture subscriber. Algorithm transaction boundaries become savepoints. Unknown/new SQL fails BEFORE dispatch. No raw database-wide query is forwarded; no worker.ts, auth-rate-limit cleanup, /api/internal/notifications or real app /api/updates is called.

The browser loads only a random-header-protected loopback server, with requests restricted to that origin and service workers blocked. Its fixture-only API uses parameterized IDs and the same owning connection. This avoids real subscriber cookies, APIs, polling jobs and side effects. Shutdown/rollback is attempted on success or failure; transport loss requires TEST-only investigation, not blind rerun.

### Actual coverage and limitations

The future harness checks a real UI FollowButton action, a fixture-only follow, actual installed PostgreSQL link trigger, exactly one publication after two links, real drainFanout logic through the scope adapter, one eligible notification, retry zero duplicates, no test-episode recipient outside the fixture subscriber, no notification for a second unrelated fixture subscriber, bell unread display, notification href/destination, mark-all-read, and unread-to-read transition when opened. An explicit fixture-scoped reset prepares the second unread test state; it is not an application mark-unread feature. It verifies fixture media/subscriber cleanup after ROLLBACK.

It DOES NOT claim to test deployed Next API authentication/session/rate limits, actual Next SSR detail rendering/router, production styling or global worker scheduling. The Link seam verifies the real generated href but serves a fixture destination. The app currently has mark-read/mark-all-read and unread display, NOT a mark-unread toggle; the harness does not invent such a feature. A test of the full deployed app remains distinct from these isolated component + database checks.

Browser executable extraction and component bundling use existing locked dependencies (`playwright-core`, `@sparticuz/chromium`, and installed transitive esbuild). No browser download, deployment, real external link fetch, R2 upload or real-user notification is needed. Artifacts are memory/temporary dependency cache, not committed files.

### Future command — DO NOT execute until separately authorized

Only after metadata acceptance, legitimate approvals, and a separately authorized successful 0007 rehearsal, in an approved environment with API/TEST access and browser runtime support:

```bash
# Dedicated secrets must already be loaded privately, never supplied as arguments.
node_modules/.bin/tsx scripts/migrations/verify-notifications-0007.mts --verify-isolated-notifications --manifest /secure/0007-rehearsal.json
```

Use the existing handoff's hidden-input secret procedure; never paste secrets into chat. This command performs bounded TEST-only fixture writes and rollback, not a read-only check. No need to recollect completed SQL checks. No application connection should point to Production/backup for this test.

Cleanup: outer ROLLBACK, verify run-tagged media and both subscriber IDs are absent, preserve 0007 objects/ledger and all pre-existing data. If the client loses transport, its uncommitted transaction should abort on disconnect, but do not claim confirmed cleanup without TEST-only evidence. Never run blanket deletes, sequence resets, or remove storage/branches. No manual cleanup of copied user records is authorized.

## Current readiness

No unrelated metadata remains to collect for this rehearsal. Code and confirmed targeting are prepared; execution still needs legitimate approvals, authorized network/secret access, and explicit TEST authorization. Follow TEST-EXECUTION.md. Neither migration nor live notification verification has been run.
