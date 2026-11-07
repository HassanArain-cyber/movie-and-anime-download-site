# Review-only one-time Production installer: migration 0007

**Prepared, NOT RUN. No database connection, migration, deployment, or environment
change is authorized by this document.** The entry point is a standalone CLI,
not imported by the app, build, migrations CLI, or CI deployment. It requires `pg`
from the repository dependencies (`npm ci` in the approved runner environment).

## Complete local review package

The entry point imports **both** `scripts/migrations/0007-catalog.mjs` and
`scripts/migrations/0007-deadline.mjs`; retain those helpers beside the runner.
The review query file is `scripts/migrations/0007-verify.sql`. Offline tests use
`tests/install-0007.test.mjs` and `tests/fixtures/0007-offline.mjs`. These are
workspace review files, not a claim of a published commit or GitHub file URL.

## Immutable artifact

The CLI reads `drizzle/0007_anime_notifications.sql` relative to its own location,
hashes its raw bytes, and rejects any SHA-256 other than:

`d6c108d47c5c45a4ff16b17ea5e07ca45f2c71b7d1e1a851a5d7143fb3c14666`

It checks the committed journal tag/index/version/breakpoints and timestamp
`1793806633286`. The original SQL is not rewritten: it is split only at Drizzle's
statement-breakpoint markers. Only that file is executed. No other migration is
loaded for execution. It does not invoke Drizzle Kit, schema push, app code,
dotenv, a worker, or an HTTP endpoint. The ledger timestamp comes from the pinned
artifact, not a Preview installation time.

## Mandatory approval and identity boundary

The Production identity and complete live ledger have **not** been independently
verified in this preparation. Do not fill guessed values or treat the example as
an approved identity. Neon project/branch mapping cannot be proven by SQL database
name alone. An authorized operator must verify in Neon's control plane that the
**direct endpoint** belongs to the approved Production project/branch, and that
the deployed app uses that database and role. Record a review reference. The CLI
checks endpoint ID/hostname consistency, URL host/port/database/role equality,
full TLS certificate/hostname verification, server database/current role/session
role, exact original search_path, and exact PostgreSQL version number (only PostgreSQL 17/18 are supported). Provider
project/branch mapping and backup restoration are operator attestations, NOT
independent online control-plane checks performed by this runner. Stale identity
or backup evidence (>24 hours) is rejected. Revalidate evidence just before use.

This narrowly reviewed installer requires the **same execution/application role**.
If Production uses a distinct migration role, do not bypass the checks: review a
separate owner/grants plan first. The actual login search_path is checked before
normalization: every existing source relation must resolve to its `public` OID.
After installation, the original login path is restored locally and all source
and new feature relation OIDs are checked, including every trigger-function
reference. This checks the connected role/session, not an independently observed
application session. An operator must still attest that the deployed app uses
this role and login settings and does not override search_path later.

The ledger owner is separately approved as `ledgerOwner`; it need not equal the
execution role. No ownership, privilege or default-ACL changes are made by the
runner. Schema USAGE/CREATE, PL/pgSQL USAGE, source SELECT/lock privileges, parent
REFERENCES, download_links TRIGGER, ledger SELECT/INSERT/lock and sequence
USAGE/SELECT are checked before DDL. Exact ledger columns/default/PK/index and
serial dependency/owner/state are inspected without nextval/setval. A sequence
behind the baseline or exhausted aborts; no reset is attempted.

Default ACL policy is deliberately strict: owner-only new tables/sequences, no
unreviewed recipient or grantor. The stock function default grants PUBLIC
EXECUTE. That is accepted only if `allowPublicFunctionExecute` is explicitly true
in the approved manifest; false aborts if that grant exists. The function is an
invoker trigger function, never SECURITY DEFINER. No ACLs are silently revoked or
changed. Global defaults and schema-specific additive defaults are checked before
DDL and rechecked before recording; resulting effective ACLs and owners are also
verified. A stricter deployment may need a separately approved default-ACL plan.
Standalone conflicting types (including array types) are rejected across schemas,
as are feature relations, function overloads, existing user rules/triggers and
enabled DDL event triggers. Concurrent DDL/default-ACL changes by other operators
remain prohibited by the maintenance agreement, not prevented globally by SQL.

## Backup and maintenance gates

Before approval:

1. Confirm Production project, branch, endpoint, database and application role.
2. Read-only audit all seven ledger IDs/hashes/timestamps against the hardcoded
   baseline in the runner. ID 7 identifies 0006, not 0007. Any deviation aborts.
3. Read-only inspect prerequisite columns, FK/PK definitions, RLS, rules and user
   triggers, plus partial objects across schemas. Conflicts need a separately
   reviewed additive plan, not drops/replacements/IF NOT EXISTS or ledger edits.
4. Create a durable provider recovery point and encrypted full logical backup,
   including content, comments, uploads/history, migration ledger, sequences,
   functions, triggers and privileges. Store outside Git/workspace with restricted
   access; record source identity, UTC times, checksum, retention and backup exit.
5. Inspect archive contents, then actually restore to a separately approved,
   isolated recovery database (never Preview/Production). Verify schema, counts,
   representative checksums, sequence state and permissions. Archive listing is
   not a restore test. Rehearse this exact artifact against that isolated restore
   using a separately reviewed test harness; do not bypass this production CLI's
   endpoint checks to make it target a local database.
6. Arrange an approved maintenance window: pause application/content writes and
   all other migration operators. Do not use this CLI to change app configuration.
   Capture count/checksum baselines for preservation comparison. Store backup and
   restore evidence references in the approval manifest, never backup contents.
7. Review runner, original SQL, manifest and statement timeout; obtain explicit
   approval for this 0007-only installation. No approval is implied by these files.

## Credential-free manifest (external, reviewed, mode 0600)

Save an approved manifest outside Git, for example
`/secure/vault/approved-0007.json`. This deliberately invalid template will not
run. Replace values only with verified Production evidence, not Preview values.
Do not include passwords, URLs, tokens or backup data in the manifest.

```json
{
  "environment": "production",
  "approvedMigrationHash": "d6c108d47c5c45a4ff16b17ea5e07ca45f2c71b7d1e1a851a5d7143fb3c14666",
  "projectId": "REPLACE_WITH_VERIFIED_NEON_PROJECT_ID",
  "branchId": "REPLACE_WITH_VERIFIED_br_ID",
  "endpointId": "REPLACE_WITH_VERIFIED_ep_ID",
  "hostname": "REPLACE_WITH_VERIFIED_DIRECT_ENDPOINT_HOSTNAME",
  "port": 5432,
  "database": "REPLACE_WITH_VERIFIED_DATABASE",
  "role": "REPLACE_WITH_VERIFIED_APPLICATION_ROLE",
  "ledgerOwner": "REPLACE_WITH_VERIFIED_LEDGER_OWNER",
  "allowPublicFunctionExecute": false,
  "originalSearchPath": "REPLACE_WITH_EXACT_current_setting_search_path",
  "serverVersionNum": "REPLACE_WITH_EXACT_server_version_num",
  "providerIdentityVerified": true,
  "applicationSearchPathVerified": true,
  "maintenanceWindowConfirmed": true,
  "approvalReference": "REPLACE_WITH_EXPLICIT_APPROVAL_REFERENCE",
  "identityVerifiedAt": "REPLACE_WITH_RECENT_ISO_UTC_TIME",
  "backupReference": "REPLACE_WITH_DURABLE_BACKUP_REFERENCE",
  "backupSha256": "REPLACE_WITH_BACKUP_SHA256",
  "backupVerifiedAt": "REPLACE_WITH_RECENT_ISO_UTC_TIME",
  "restoreVerificationReference": "REPLACE_WITH_SUCCESSFUL_ISOLATED_RESTORE_EVIDENCE",
  "statementTimeoutMs": 60000,
  "networkTimeoutMs": 65000,
  "overallTimeoutMs": 300000,
  "cleanupTimeoutMs": 3000
}
```

## Exact execution command — FUTURE, AFTER APPROVAL ONLY

From the repository root, in a trusted terminal with shell tracing disabled:

```bash
set +x
read -r -s -p 'Approved Production database URL: ' VAULT_0007_DATABASE_URL
printf '\n'
export VAULT_0007_DATABASE_URL
node scripts/migrations/install-0007.mjs \
  --apply-approved-0007 --manifest /secure/vault/approved-0007.json
result=$?
unset VAULT_0007_DATABASE_URL
# Preserve the result in automation; do not blindly retry a nonzero result.
(exit "$result")
```

The URL is entered without echo, never passed as a command argument, and never
printed. Do not paste it into chat, logs or shell history. The runner does not
read generic `DATABASE_URL`, dotenv files or inherited PG connection options.
Use the approved direct Neon URL. Connection query parameters are limited to
`sslmode` and `channel_binding`; explicit pg configuration enforces TLS hostname
verification regardless of URL sslmode. The `pg` TLS connection is used, not a
claim that SCRAM channel binding is enforced by this CLI. Password authentication
must be supported by the approved endpoint. Restrict access to the process's
environment on the execution host; environment transport is not a secret vault.

## Transaction, locks and failure behavior

Before opening a connection: validate approval flags, artifact bytes, journal,
manifest, recent operator evidence and exact URL identity.

One client then executes ONE transaction:

1. Startup options set server statement/lock/idle/transaction timeouts even for
   initial identity queries. A client monotonic overall deadline begins before
   BEGIN; the CLI has a separate 10-second connection-establishment timeout.
2. Validate database/role/session role/version/path and actual source OID
   resolution. Set local installation path to public (implicit pg_catalog first),
   synchronous_commit=on, lock_timeout=5s, idle timeout=10s, statement timeout and
   transaction_timeout. PG17/18's transaction_timeout bounds total server
   transaction duration. Older versions are rejected, not silently downgraded.
3. Verify all installation privileges and exact ledger table/PK/index/default,
   sequence dependencies/ownership/privileges/state before invoking its default.
4. Acquire locks in one fixed order: ledger EXCLUSIVE -> media -> seasons ->
   episodes -> download_links SHARE ROW EXCLUSIVE. Revalidate ledger schema/state
   under its lock, then all seven exact baseline records. Source locks freeze
   parent/link writes through preflight, backfill, verification and commit. No
   other migration operator or concurrent DDL is allowed. This is broader than
   the original link-only lock; it intentionally trades bounded downtime for a
   stable integrity check. Lock-order inversions with active app transactions
   can still cause failure: drain writes first; never auto-retry a deadlock.
5. Check types, rules/triggers/event triggers, exact prerequisite types/nullability,
   PKs/FKs/RLS/inheritance, parent relationships, and strict default ACL policy.
6. Send each original SQL chunk unchanged in original order. No other migration
   is executed. The only existing-relation DDL is its download_links trigger;
   backfill writes only the new publication table.
7. Check exact new table columns/defaults/NOT NULL, named PK/FK/CHECK definitions,
   FK actions, exact indexes, owners/ACLs, serial ownership/default dependencies,
   exact function body AND execution flags, and exact trigger UPDATE OF columns,
   event bits, condition/argument/transition-table absence and enabled status.
   NOT NULL uses attnotnull, separately from p/f/c constraints: PostgreSQL 18's
   additional contype=n records do not break constraint counting.
8. Restore actual login path temporarily, verify all unqualified application and
   trigger names against public OIDs, then restore the installation path. Check
   historical processed-publication coverage. Recheck defaults and old ledger.
9. Insert exactly one parameterized hash/timestamp record, verify old and new
   entries and require an actual COMMIT command acknowledgement.

The approved overall budget is at most 10 minutes (example: 5 minutes). Each
network operation is bounded by min(networkTimeoutMs, remaining overall budget);
server statement timeout must be shorter than client network timeout. Cleanup
gets a separate bounded allowance (example: 3 seconds). A deadline closes the
connection using pg Client.end(), which destroys its socket when a query is
active. A timed-out socket is never reused for ROLLBACK or another statement.
A normal error on a healthy transport gets one bounded ROLLBACK attempt, followed
by bounded client shutdown. There are no autonomous retries. TCP keepalive is
enabled as a supplement, not the deadline mechanism. Server timeouts plus client
bounds reduce lock-duration risk; they are not a hard real-time guarantee during
host suspension, a wedged event loop or database/provider failure. A server-side
rollback itself can also take time. Observe the maintenance window externally.

No original ledger row is modified. The new ID is generated normally and need not
be 8. Failed transactions can leave sequence gaps; never reset a sequence to
"fix" gaps. Runner errors never print provider messages, query values or URLs.

Any ordinary pre-commit error triggers ROLLBACK: new tables/sequence/indexes/
function/trigger, publication backfill and ledger row are rolled back together;
locks are released. Transaction rollback is NOT a post-commit downgrade script.
If connection loss/process termination/timeout makes completion uncertain,
**do not retry** until read-only ledger AND catalog checks establish the outcome.
A failed COMMIT acknowledgement is explicitly reported as ambiguous: rollback
attempt does not prove a commit failed. An acknowledged COMMIT remains acknowledged if shutdown later fails; cleanup
is bounded and never triggers an automatic rerun. If COMMIT is attempted but its
response is lost, times out or is not a COMMIT command, outcome remains uncertain.
After confirmed success, a second run aborts at baseline validation. Never remove
its ledger row, drop the new objects or restore over live writes as an automatic
rollback. Any post-commit remediation needs separate approval and a backup-aware
plan preserving new subscribers/follows/notifications.

## Post-migration review (READ-ONLY)

Use `scripts/migrations/0007-verify.sql` as the verified application role, on the
same verified endpoint. It contains SELECT statements only. To keep credentials
out of command arguments, use an already approved local PostgreSQL service:

```bash
psql 'service=vault-production-verified' -X --set=ON_ERROR_STOP=1 \
  --file=scripts/migrations/0007-verify.sql
```

The service must have been independently reviewed to resolve to the approved
Production endpoint/database/role; this document does not create it. Verify:
original seven ledger rows unchanged, exactly one new pair, four tables and their
column/default/constraint definitions, six FKs, four PKs, one status check, eight
valid indexes, owned serial sequence, exact function body, enabled trigger and
zero missing legacy publications. New writes after maintenance can legitimately
create pending publications. Compare original content counts/checksums to backup
baselines while accounting for legitimate concurrent writes. Re-enable approved
application traffic only after acceptance. Follow/notification HTTP tests require
separate write-test approval, even for GET endpoints.

## Validation scope

Offline tests: `node --test tests/install-0007.test.mjs` (strict fake pg client,
no sockets). They cover every column/default/not-null contract, ledger and
sequence checks, PK/FK/CHECK/index mutations, PG18 category separation, standalone
types, role resolution, privilege and ACL failures, function/trigger changes,
rollback/COMMIT uncertainty and bounded transport/overall/cleanup deadlines.
Unrecognized fake queries fail rather than silently succeed. Fixtures are
synthetic, not PostgreSQL-captured catalog output. **Mocks are not PostgreSQL/Neon
proof and cannot validate SQL syntax, deparser formatting, concurrency or grants.**

No PostgreSQL 18.6, initdb or Docker executable is available in this workspace.
No database was connected and no SQL or installer CLI was executed. A real
restricted-role 18.6 rehearsal remains REQUIRED before any Production approval.
In particular, confirm catalog query syntax and deparser contracts, serial
ownership/default dependencies, effective default ACLs, lock/deadline behavior,
fault-injected rollback, and server/transport loss around COMMIT. The revised
runner is review material, not a claim of Production safety or authorization.
