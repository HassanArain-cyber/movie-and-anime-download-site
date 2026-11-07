# 0007 disposable rehearsal — authorized-environment handoff

**Current operational scope: see TEST-EXECUTION.md. Only TEST, backup parent and Production reference require live branch verification. Historical branch metadata is retained, not a new prerequisite.**

Prepared, NOT executed. This package uses the existing updated rehearsal installer in this repository. It is executable after an authorized operator supplies the deliberately missing approvals and private runtime credentials. Those are safety gates, not requests to repeat confirmed SQL results. No Production execution approval is implied.

See **NEXT-STEPS.md** for credential-free metadata submission and the new gated isolated notification harness. Live functionality remains unverified.

## Package inventory

Keep the repository layout intact; do not copy just the CLI file:

- `scripts/migrations/rehearse-0007.mjs`: rehearsal gate and read-only provider verification.
- `scripts/migrations/0007-engine.mjs`: transaction and rehearsal-only ACL restriction.
- `scripts/migrations/install-0007.mjs`: imported immutable-artifact checks, baseline/preflight and object verification; its Production CLI is NOT invoked.
- `scripts/migrations/0007-catalog.mjs` and `0007-deadline.mjs`: required helpers.
- `drizzle/0007_anime_notifications.sql` and `drizzle/meta/_journal.json`: original artifacts, not rewritten.
- `docs/0007-disposable-rehearsal/manifest.template.json`: credential-free target template, populated with supplied facts; null approvals intentionally prevent execution.
- `docs/0007-disposable-rehearsal/post-rehearsal.sql`: focused read-only result evidence.
- `scripts/migrations/0007-verify.sql`: optional full read-only catalog/backfill evidence, not an installer.
- `docs/rehearsal-0007-installer.md`: detailed technical guide.

Use the current workspace versions, including uncommitted/untracked review files. They are not guaranteed to exist in a fresh checkout of PR #7/main. No commit or publication has been authorized. The historical `docs/rehearsal-0007-review-diff.md` predates the owner-only ACL update and is not this package's authoritative implementation snapshot.

## Confirmed evidence — retain, do not recollect routinely

Project `weathered-fog-95101745`; test branch `test-0007-migration` / `br-round-scene-b5t9covj`; direct target `ep-morning-poetry-b5eo42g4.c-7.us-east-2.aws.neon.tech` / `ep-morning-poetry-b5eo42g4`. Backup IDs: `br-lucky-feather-b57gf857` / `ep-noisy-rice-b53bwzqh`; Production IDs: `br-orange-butterfly-b5iijgxu` / `ep-delicate-sunset-b5inue9w`.

User-confirmed TEST SQL facts: `neondb`; current/session role `neondb_owner`; PostgreSQL 18.6 / `180006`; login search_path `"$user", public`; writable transaction setting; ledger and sequence owned by `neondb_owner`; no existing named trigger function; public USAGE+CREATE, drizzle USAGE, PL/pgSQL USAGE and download_links TRIGGER available; global built-in owner/PUBLIC EXECUTE without grant option; no public-schema custom function defaults.

These facts are carried into the template. They do not substitute for the installer's runtime assertions or prove provider routing. Existing local results: project tests 72/72; migration offline tests 105/105 (including complete-inventory rejection cases); TypeScript, ESLint, syntax and production build passed. Original SQL, journal, Production installer and locked dependencies were preserved in the last local validation. No live rehearsal was performed.

## Complete supplied branch-to-endpoint inventory

The following complete mapping is user-verified dashboard evidence. It is not a live API result obtained by this package preparation. `ep-morning-poetry-b5eo42g4` remains the sole target; all seven others are excluded, including Preview and historical branches.

| Branch | Endpoint | Disposition |
|---|---|---|
| production | `ep-delicate-sunset-b5inue9w` | Excluded |
| test-0007-migration | `ep-morning-poetry-b5eo42g4` | Sole target |
| preview | `ep-still-darkness-b5bsw66y` | Excluded |
| production-before-0007-0008 | `ep-restless-king-b539mkzg` | Excluded |
| pre-0007-migration-backup | `ep-noisy-rice-b53bwzqh` | Excluded |
| preview-before-pr7-migration | `ep-round-forest-b5nk3wmj` | Excluded |
| preview-before-0008 | `ep-orange-glade-b5jrxh1l` | Excluded |
| before-comments-migration | `ep-polished-dawn-b5jbwun9` | Excluded |

The template's `endpointBranchNames` pins these exact names by endpoint ID. All eight actual Console-confirmed branch IDs are now pinned in `endpointBranchIds` and `branchInventory`, along with seven confirmed parent links. No branch IDs are invented. Names `production` and `preview` reflect the latest lowercase Console inventory; endpoint associations are unchanged. The authorized future API check resolves each endpoint's actual branch ID, reads its branch identity, and compares pinned endpoint-to-branch IDs; only the three reference branches require live name/project/parent/default metadata. Known test/backup/Production IDs and parent/default requirements remain independently enforced. All branches are confirmed in project `weathered-fog-95101745`. Production is confirmed root/default (Console Parent “—”): its parent_id is null with parent_verified=true, not unknown. The TEST endpoint read_write type and direct hostname are confirmed. Unrelated endpoint types/hosts/default fields remain unset as reference data and are NOT required by this rehearsal. Project IDs on endpoints follow their confirmed branch/project mappings. Live API revalidation remains a separate execution gate; it does not erase confirmed Console facts.

The gate requires the provider endpoint-ID set to equal exactly the sole target plus all exclusions. Missing excluded IDs, unapproved new endpoints, duplicates, excluded endpoints on the test branch, swapped mappings, malformed identities/hosts, continuation indicators and inconsistent totals all abort before any database connection. It does not silently update approvals or fetch a later page. Complete-looking provider responses can only be assessed against their declared metadata and this approved eight-ID inventory; no client can prove an undisclosed provider omission beyond that evidence.

## Mandatory owner-only policy and transaction sequence

`allowPublicFunctionExecute` MUST be false and execution role MUST be `neondb_owner`. The function remains SECURITY INVOKER. No additional application role or grants are invented.

1. Approval/target/artifact validation and read-only provider GET verification precede PostgreSQL connection.
2. BEGIN; assert actual identity/path, privileges, ledger/sequence contracts, exact baseline, fixed-order locks, schema/data preflight and defaults.
3. Execute unchanged original SQL chunks. Immediately after the original function-creation chunk, execute fixed `REVOKE EXECUTE ON FUNCTION public.vault_record_episode_publication() FROM PUBLIC` inside that transaction.
4. Assert owner EXECUTE remains and PUBLIC/unexpected recipients are absent. Do not mask divergence with a GRANT.
5. Continue original chunks/backfill. Trigger creation is explicitly guarded by the completed ACL verification.
6. Verify final object/function/ACL/trigger/backfill/path contracts, verify defaults again, insert and verify the exact ledger pair, then COMMIT.

Creation-default validation tolerates only the existing checker's owner/non-grantable PUBLIC EXECUTE function grants pending the explicit object restriction. Table/sequence defaults are not relaxed; no default privileges are modified. Production behavior receives no new REVOKE. Pre-COMMIT failure attempts bounded rollback; transport loss may prevent confirmation. Any attempted-COMMIT error is uncertain and prohibits blind rerun.

Pinned SQL SHA-256: `d6c108d47c5c45a4ff16b17ea5e07ca45f2c71b7d1e1a851a5d7143fb3c14666`.
Journal SHA-256 from prior validation: `f412548466a281a4f00351393445805979ae25433f794d950ca3749830145606`.
Ledger timestamp: `1793806633286`. No other migration is run.

## Access and permissions

Use a trusted, unrecorded terminal with Node/npm, the repository and pinned `pg` dependency. If needed, restore the lockfile dependencies with `npm ci --ignore-scripts --no-audit --no-fund`; do not regenerate the lockfile.

Required outbound access:
- HTTPS 443 to `console.neon.tech` for provider verification.
- TLS PostgreSQL 5432 ONLY to the pinned TEST hostname above.
- npm registry access only if installing dependencies.

This Arena environment cannot currently provide the necessary Neon access. Do not bypass its allowlist. Move execution to an authorized environment; do not change the installer to omit the API gate.

Provide a Neon API credential through the dedicated secret environment variable, with authorization to READ these resources in the specified project:

```
GET /api/v2/projects/weathered-fog-95101745/branches/br-round-scene-b5t9covj
GET /api/v2/projects/weathered-fog-95101745/branches/br-lucky-feather-b57gf857
GET /api/v2/projects/weathered-fog-95101745/branches/br-orange-butterfly-b5iijgxu
GET /api/v2/projects/weathered-fog-95101745/endpoints
```

Read access covers only the three reference branches and project endpoints. No database connection to excluded branches is involved. Use the least available provider scope that permits these GETs. No branch/endpoint creation, deletion, role/password changes or database administration API permission is required by this CLI. Exact credential scope labels depend on provider capabilities; do not invent a scope name or imply Neon offers a read-only token variant if unavailable. Never send the credential in chat. The CLI makes metadata GETs for exclusion/provenance verification, not SQL connections to Production/backup. If even those metadata reads are not approved, do not run.

Database role permissions must already satisfy the existing installer: schema/language privileges; ledger SELECT+INSERT and lock-capable privilege; SELECT and lock-capable privilege on source tables; required REFERENCES and TRIGGER; sequence access. Ownership/ACL/default contracts are asserted, not repaired. This runbook does not authorize grants or role changes.

## Pre-execution operator gate — no new routine audit

- Use the supplied TEST target exclusively. Disable application writers, notification workers and concurrent migration operators on the disposable branch during installation. Do not change Production/backup workloads.
- Retain existing confirmed evidence. The CLI automatically checks unresolved runtime preflight facts before DDL and rechecks lock-sensitive contracts; any mismatch means STOP, not repair or repeated execution.
- Complete only missing approvals in a private copy of the template: real approval reference, actual identity-review timestamp within 24 hours of execution, disposable approval, maintenance confirmation and application-search-path verification. Do not fabricate them. No Production backup/restore attestation belongs in this rehearsal manifest.
- API verification remains PENDING, not failed or verified: test name/parent/non-default; backup name; Production default; test endpoint ID/branch/host/type `read_write`; all seven non-test endpoints covered with their approved branch names. The supplied seven exclusions represent the complete approved non-test inventory. If provider metadata reveals additional endpoints, stop and review/update the exclusion list in the approved manifest before running again. Missing fields/pagination must not be guessed or bypassed.
- Current code requires at least one endpoint for backup and Production, exact approved endpoint-set equality, and pinned branch-ID agreement for every endpoint; live branch identity checks are limited to the three references. It rejects continuation/pagination rather than fetching further pages. Unsupported/incomplete API metadata is a stop condition. Do not remove those gates.
- Do not use this command as a dry run: a successful invocation commits on TEST. No automatic retry is permitted after connection/installation failure without outcome investigation.

## Exact future execution command — NOT RUN during package preparation

From the repository root, first copy `docs/0007-disposable-rehearsal/manifest.template.json` to `/secure/0007-rehearsal.json` in a private directory and complete only the legitimate missing approvals. Restrict file permissions. Do not overwrite a prior approved manifest blindly.

Run this Bash block ONLY after execution authorization. Hidden input avoids history/argument exposure; privileged local processes may still inspect environment secrets. Do not use a recorded terminal or shell tracing. No generic DATABASE_URL or Production-secret fallback is used.

```bash
set +x
(
  set -e
  trap 'unset VAULT_0007_REHEARSAL_DATABASE_URL VAULT_0007_REHEARSAL_NEON_API_KEY' EXIT
  read -r -s -p 'Disposable TEST direct PostgreSQL URL: ' VAULT_0007_REHEARSAL_DATABASE_URL
  printf '\n'
  read -r -s -p 'Authorized Neon API credential: ' VAULT_0007_REHEARSAL_NEON_API_KEY
  printf '\n'
  export VAULT_0007_REHEARSAL_DATABASE_URL VAULT_0007_REHEARSAL_NEON_API_KEY
  node scripts/migrations/rehearse-0007.mjs --apply-disposable-rehearsal-0007 --manifest /secure/0007-rehearsal.json
)
```

The subshell's exit status is the installer status; do not mask it. If your environment preloaded these secrets outside the subshell, unset them separately afterward. Never log URLs, secrets, authorization headers or raw provider error objects.

## Post-rehearsal evidence and disposition

1. Retain exit status and sanitized success/uncertain-outcome advisory. Successful COMMIT acknowledgement is not permission to run again.
2. On the same verified TEST endpoint, use `post-rehearsal.sql` for ledger pair, owner-only function ACL, invoker properties and enabled trigger evidence. Use the existing full verifier only where further evidence is needed; no need to repeat previously confirmed preparation facts. Rehearsal policy overrides the generic full verifier's comment allowing explicitly approved PUBLIC access: this rehearsal permits none.
3. Confirm original seven ledger entries remain unchanged, exactly one 0007 entry exists, no unexpected feature grants exist, and the backfill is processed. Preserve existing content/R2 history; never reset sequences, relabel ledger history or run 0008 as repair.
4. Functional test and notification processing are separate write-test operations, not performed by the installer. Use an approved isolated fixture and cleanup plan as below; do not claim them from offline tests or from a publication alone.
5. Collect sanitized final evidence and decide whether to retain the disposable branch for review. Do not delete/reset/recreate any branch, alter the backup, or roll back the committed migration by dropping objects/ledger rows under this package. Branch deletion requires separate explicit approval and exact branch-ID review.

### Isolated functional verification and cleanup

The current application worker is NOT scoped to a test episode. `processNotifications()` also deletes expired auth-rate-limit rows; `drainFanout()` selects pending publications across the whole database. Therefore do NOT call `/api/updates`, `/api/internal/notifications`, or the broad worker as an assumed scoped test. The package now includes an isolated fixture harness and offline metadata reviewer; see `NEXT-STEPS.md`. It runs the real fanout algorithm through a fail-closed scope adapter, not the database-wide worker. It does not claim full deployed Next API/router coverage.

Before any separately authorized write test, use the fixture-only transaction harness documented in `NEXT-STEPS.md`, or separately review another isolated strategy. The included harness never commits fixture rows and uses a fixture-only UI backend. Do not mark copied subscriber/publication rows processed to force isolation. If isolation is unavailable, stop only the functional test; preserve successful migration evidence and label functional verification PENDING.

For the approved strategy:
- Create uniquely tagged new media/season/episode plus a new subscriber/follow; never repurpose existing content or followers. Capture exact inserted IDs and a unique run marker in private evidence. Create the follow before publication eligibility time. Ensure no unrelated subscriber follows the new media.
- Add the eligible link through the reviewed path. Confirm exactly one publication for that episode; the trigger creates a publication, not a notification.
- Exercise the reviewed processing strategy and confirm the isolated subscriber receives exactly one matching notification, processing completes, no unrelated subscriber receives a test-episode notification, and retry is idempotent. Owner-only trigger EXECUTE must remain intact throughout.
- Cleanup only captured run-owned rows, using parameterized exact IDs with run-marker and relationship assertions. Delete test notification/follow/publication/link rows and then test episode/season/media/subscriber as appropriate for actual FK dependencies. Verify references first; never issue blanket DELETE/TRUNCATE, modify copied user data, remove storage objects, or reset sequence values. Stop on uncertain ownership.
- Confirm fixture rows and associated test notifications are absent and pre-existing data remains untouched. Preserve 0007 objects, ACLs and ledger entry. Cleanup is separately authorized TEST-only DML, not part of the read-only postcheck SQL or this preparation.

## Handoff status

Local code/documentation package prepared. Endpoint API evidence, actual operational approvals, secure execution access and live installation/functional evidence remain runtime/operator gates, not fabricated completed checks. No database, Neon API, migration, installer or deployment was executed while assembling/updating this handoff. Dependency restoration and mocked offline tests, TypeScript and lint checks were run locally for the inventory update. Production and backup were not contacted or modified.
