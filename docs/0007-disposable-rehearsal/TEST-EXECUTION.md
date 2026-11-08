# TEST-only 0007 execution readiness — not execution authorization

This is the current operational scope. It supersedes older all-eight-branch metadata collection instructions. All confirmed metadata remains recorded; no unrelated metadata collection is required.

## Target and reference scope

- Sole database target: test-0007-migration / br-round-scene-b5t9covj / ep-morning-poetry-b5eo42g4 / ep-morning-poetry-b5eo42g4.c-7.us-east-2.aws.neon.tech / read_write.
- Parent metadata reference only: pre-0007-migration-backup / br-lucky-feather-b57gf857.
- Production metadata reference only: production / br-orange-butterfly-b5iijgxu, root/default.
- Project: weathered-fog-95101745; DB neondb; login/owner neondb_owner; PostgreSQL 18.6 / 180006.

The API gate performs exactly four read-only GETs: these three branch resources plus the project's endpoint inventory. It verifies target identity/name/project/parent/non-default status, backup identity/project/parent, Production identity/project/root/default, and the sole target endpoint's host/type/branch. All eight existing endpoint IDs and their known branch-ID mappings are retained as an exclusion guard. Inventory completeness/pagination, duplicate/missing/unapproved endpoint IDs, any excluded endpoint on TEST, and any pinned endpoint-to-branch mismatch still abort. It does NOT fetch the other five branch resources or require non-test endpoint types, direct hosts, or default flags.

## What is actually needed before execution

1. A trusted environment with HTTPS access to console.neon.tech and TLS PostgreSQL access ONLY to the pinned TEST host, plus Node/npm and this complete workspace package. Arena currently cannot provide Neon access; no claim of live API verification is made.
2. Legitimate approvals in a private copy of manifest.template.json: actual approvalReference, timely identityVerifiedAt (less than 24 hours), and truthful disposableBranchApproved, maintenanceWindowConfirmed and applicationSearchPathVerified confirmations. The repository template stays null. Do not invent approvals or treat this document as one.
3. Dedicated private runtime credentials: VAULT_0007_REHEARSAL_DATABASE_URL for the direct TEST endpoint and VAULT_0007_REHEARSAL_NEON_API_KEY with read access to the three branch metadata resources and project endpoints. No secrets in chat, manifests, arguments or logs. No generic DATABASE_URL fallback.
4. Explicit authorization to execute the TEST migration. The installer itself performs unresolved runtime preflight checks before DDL; do not recollect completed SQL facts or manually repair mismatches. Pause TEST application writers/jobs and concurrent operators. Do not alter Production/backup workloads or connect to their databases.

No endpoint types/hosts/default booleans for unrelated resources, new parent surveys, branch ID collection or repeated project checks are prerequisites.

## Manual Console + trusted-terminal path (FUTURE; not run)

1. Open Neon Console, select weathered-fog-95101745, open test-0007-migration. Verify the selected branch is br-round-scene-b5t9covj. Do not select Production or backup as a database target.
2. Open Connect for TEST. Select neondb and neondb_owner. Turn connection pooling OFF. Use the pinned direct hostname above. Keep the resulting URL private; do not paste it in chat. Do not change passwords/roles/privileges.
3. Use an already authorized Neon API credential locally for the installer's metadata GETs. No write/admin API operations are needed. If suitable access is unavailable, stop—do not bypass this gate or improvise SQL in the editor.
4. In the trusted environment, retain the repository layout and current uncommitted review files; a fresh checkout of old PR #7 may not contain them. Restore locked dependencies if absent: npm ci --ignore-scripts --no-audit --no-fund.
5. Copy the template to /secure/0007-rehearsal.json. Fill only legitimately confirmed approval fields. Preserve the known target, seven exclusions, owner-only policy false, original hash and safety limits.
6. After explicit TEST execution authorization, from the repository root run:

```bash
set +x
(
  set -e
  trap 'unset VAULT_0007_REHEARSAL_DATABASE_URL VAULT_0007_REHEARSAL_NEON_API_KEY' EXIT
  read -r -s -p 'TEST direct PostgreSQL URL: ' VAULT_0007_REHEARSAL_DATABASE_URL
  printf '\n'
  read -r -s -p 'Authorized Neon API credential: ' VAULT_0007_REHEARSAL_NEON_API_KEY
  printf '\n'
  export VAULT_0007_REHEARSAL_DATABASE_URL VAULT_0007_REHEARSAL_NEON_API_KEY
  node scripts/migrations/rehearse-0007.mjs --apply-disposable-rehearsal-0007 --manifest /secure/0007-rehearsal.json
)
```

A successful run commits on TEST. Keep the subshell exit status; do not rerun on uncertain outcome. Credentials are hidden-input but still readable by privileged local processes; use an unrecorded terminal. If preloaded outside this subshell, unset them there too.

The Neon SQL Editor alone cannot run this Node installer or reproduce its API, timeout, catalog and uncertain-COMMIT safeguards. Do not paste bare original 0007 into SQL Editor as a substitute. This package intentionally supplies no alternate migration SQL that skips those gates.

## ACL and transaction review

The original SQL/hash and journal are unchanged. The TEST transaction creates the unchanged function, immediately revokes PUBLIC EXECUTE and asserts owner-only EXECUTE before trigger creation. Owner neondb_owner retains EXECUTE. Table/sequence default checks remain strict. Final object/ACL/backfill verification and ledger recording precede COMMIT. Pre-COMMIT failure attempts bounded rollback; attempted-COMMIT failure remains uncertain. Production installer behavior is unchanged.

## After successful installation: separately authorized isolated harness

Do not start the harness until separately authorized. It verifies the same API target and requires installed 0007; it never migrates. It uses new cryptographic fixtures in one uncommitted outer transaction, real trigger and scoped real fanout, a fixture-only loopback browser backend, and actual follow/bell/inbox components. It never imports/calls the database-wide worker, app /api/updates or /api/internal/notifications. All fixture rows roll back; sequences may advance and are not reset.

```bash
# Same private dedicated credentials and legitimately approved manifest required.
node_modules/.bin/tsx scripts/migrations/verify-notifications-0007.mts --verify-isolated-notifications --manifest /secure/0007-rehearsal.json
```

The harness tests follow/publication/notification/deduplication/isolation, bell href and read transitions. It does not claim actual Next SSR detail-page/API auth coverage; the app has no mark-unread toggle. No live functionality has yet been verified. On cleanup/connection uncertainty, investigate only TEST before retrying; never blanket-delete records or reset sequences. Post-rehearsal.sql provides read-only result evidence after authorization.
