# Disposable 0007 rehearsal — PREPARED, NOT EXECUTED

Only `test-0007-migration`, with parent `pre-0007-migration-backup`, is permitted. This run commits on the disposable branch. It does not approve Production execution. No connection or provider request was made during preparation.

## Structural change

The Production CLI, validator, secret name and approval flag are unchanged. Its `install()` validates the original Production manifest and delegates to `0007-engine.mjs`. The shared engine retains the Production transaction path and adds an explicitly rehearsal-only ACL restriction path. Each wrapper performs its own approval validation before invoking the engine. Both wrappers use the existing catalog and deadline helpers. Production backup and restore requirements are not relaxed. The Production source file necessarily has a mechanical import/wrapper change; it is not byte-identical.

## Identity gates

The rehearsal CLI requires `--apply-disposable-rehearsal-0007`, `environment: "rehearsal"`, the exact branch name, version `180006`, and a dedicated URL. No `DATABASE_URL` or Production-secret fallback exists. TLS hostname/certificate verification is mandatory; poolers are rejected.

Before opening PostgreSQL, read-only Neon API GETs verify the pinned project branch IDs, test name, parent ID, non-default test status, backup name, Production default status, and direct read-write endpoint ID/host/branch mapping. All non-test endpoints in the complete returned inventory must be explicitly excluded. The endpoint-ID set must exactly match the target plus exclusions; every endpoint must map to its pinned branch ID. Only TEST, backup parent and Production reference branch identities are read; other branches are not fetched and their endpoint types/hosts/default fields are not required. Missing, duplicate, unexpected, excluded-on-test or paginated endpoint data aborts before connection. These are control-plane metadata reads, not SQL connections to those branches. No control-plane mutation is implemented. The operator must approve these metadata reads as part of any future execution. If those reads are not authorized, do not run.

This API check needs a separately supplied Neon API credential with only the necessary read access. Never paste it into chat. The current Arena host allowlist does not include `console.neon.tech`; future execution must occur in an approved environment with access to it and the test PostgreSQL endpoint. Do not bypass network policy. If provider response fields differ or evidence is incomplete, stop; never guess IDs or disable checks. No API behavior has been live-tested.

SQL cannot prove a Neon branch ID. The control plane proves the routing mapping, verified TLS binds the URL host, and the transaction identity query independently checks actual database, login/current role, exact version, search path and temporary schema before migration SQL. No role creation, privilege grants, default-privilege changes or automatic repair is implemented. The rehearsal-only path explicitly revokes PUBLIC EXECUTE on the new function in its installation transaction. The reviewed role must already have all required privileges.

## Credential-free manifest

Create `/secure/0007-rehearsal.json` outside Git after obtaining actual non-secret IDs and reviewing the role, path, ledger owner and ACL policy. The following is a template, NOT valid approval evidence. Replace every placeholder with truthful reviewed values. Do not copy Production backup/restore attestations into it.

```json
{
  "environment": "rehearsal",
  "branchName": "test-0007-migration",
  "approvedMigrationHash": "d6c108d47c5c45a4ff16b17ea5e07ca45f2c71b7d1e1a851a5d7143fb3c14666",
  "projectId": "REPLACE",
  "branchId": "REPLACE",
  "backupBranchId": "REPLACE",
  "productionBranchId": "REPLACE",
  "endpointId": "REPLACE",
  "hostname": "REPLACE",
  "excludedEndpointIds": ["REPLACE_PRODUCTION_ENDPOINT", "REPLACE_BACKUP_ENDPOINT"],
  "endpointBranchNames": {
    "REPLACE_TEST_ENDPOINT": "test-0007-migration",
    "REPLACE_PRODUCTION_ENDPOINT": "Production",
    "REPLACE_BACKUP_ENDPOINT": "pre-0007-migration-backup"
  },
  "port": 5432,
  "database": "REPLACE",
  "role": "neondb_owner",
  "ledgerOwner": "REPLACE",
  "originalSearchPath": "REPLACE",
  "serverVersionNum": "180006",
  "approvalReference": "REPLACE",
  "identityVerifiedAt": "REPLACE",
  "disposableBranchApproved": null,
  "maintenanceWindowConfirmed": null,
  "applicationSearchPathVerified": null,
  "allowPublicFunctionExecute": false,
  "statementTimeoutMs": 60000,
  "networkTimeoutMs": 65000,
  "overallTimeoutMs": 300000,
  "cleanupTimeoutMs": 3000
}
```

This generic example must enumerate every non-test endpoint and its exact branch name; the populated eight-endpoint template is in `docs/0007-disposable-rehearsal/manifest.template.json`.

The three null operational approvals deliberately make this template invalid. Set them to true only after truthful operator confirmation. `allowPublicFunctionExecute` is mandatory false, not an optional acceptance of inherited PUBLIC access; the required rehearsal owner/login role is `neondb_owner`. The identity review must be less than 24 hours old. This guide is a generic template, not a replacement for the collected test-branch evidence or an approved manifest. Preserve previously confirmed facts; independently verified control-plane routing and unresolved preflight/operational evidence remain prerequisites.

## Mandatory owner-only function EXECUTE policy

The function is SECURITY INVOKER, not SECURITY DEFINER. PostgreSQL's built-in function default grants EXECUTE to PUBLIC and the owner. No custom default row does not mean PUBLIC access is absent.

The rehearsal path tolerates only the existing checker’s owner and non-grantable PUBLIC EXECUTE function defaults during creation. It still rejects unrelated recipients, unexpected grantors and PUBLIC grant options. Table and sequence default-ACL checks are unchanged. This does not change defaults or authorize PUBLIC access on the final function.

### Exact transactional order

1. Validate the rehearsal-only manifest/flag/secret and provider identity before connecting. Verify the original SQL hash and journal.
2. Begin one transaction. Check actual login identity, name resolution, privileges, exact ledger/sequence baseline, fixed-order locks, schema/data preflight and creation defaults.
3. Send each original migration chunk unchanged. Immediately after the chunk creating `vault_record_episode_publication()`, execute the additional fixed statement:

   ```sql
   REVOKE EXECUTE ON FUNCTION public.vault_record_episode_publication() FROM PUBLIC;
   ```

4. Immediately inspect the function ACL. Require owner EXECUTE for `neondb_owner` and reject every PUBLIC/unexpected-role grant. Owner EXECUTE is preserved, not re-granted to conceal a mismatch.
5. Continue the original chunks, including the legacy backfill. Create `vault_episode_first_link` only after the ACL verification has succeeded; an explicit ordering guard enforces this.
6. Verify resulting object contracts, function SECURITY INVOKER/body/owner/settings and owner-only ACL again, trigger definition, backfill, application name resolution and creation defaults. Insert and verify the exact 0007 ledger entry, then COMMIT.

The original SQL file stays byte-identical; the rehearsal transaction includes the additional REVOKE and verification. The Production path does not perform this added REVOKE and keeps its original manifest/default-ACL policy. No 0008 is executed.

Any pre-COMMIT ACL/query/verification failure aborts the installation and attempts bounded rollback. Transport loss can prevent rollback confirmation; do not claim guaranteed rollback without evidence. Any attempted-COMMIT failure remains explicitly uncertain and requires read-only investigation before retry.

### Scope of verification

Offline tests cover successful restriction, grant rejection, rollback, statement ordering, immutable SQL, Production isolation and uncertain COMMIT. They do not prove live PostgreSQL behavior. The link trigger creates an `episode_publications` record, not a notification directly. A separately approved isolated subscriber/follow/publication test and scoped notification-processing/cleanup plan are still required; this installer does not perform that test or invoke application endpoints.

## Exact FUTURE command — DO NOT RUN without separate execution approval

Requires the repository's pinned `pg` dependency installed. In an unrecorded trusted Bash terminal (environment secrets can still be inspected by privileged local processes):

```bash
set +x
read -r -s -p 'Disposable test-0007-migration DIRECT URL: ' VAULT_0007_REHEARSAL_DATABASE_URL
printf '\n'
read -r -s -p 'Neon read-only API key: ' VAULT_0007_REHEARSAL_NEON_API_KEY
printf '\n'
export VAULT_0007_REHEARSAL_DATABASE_URL VAULT_0007_REHEARSAL_NEON_API_KEY
(
  trap 'unset VAULT_0007_REHEARSAL_DATABASE_URL VAULT_0007_REHEARSAL_NEON_API_KEY' EXIT
  node scripts/migrations/rehearse-0007.mjs --apply-disposable-rehearsal-0007 --manifest /secure/0007-rehearsal.json
)
rehearsal_status=$?
unset VAULT_0007_REHEARSAL_DATABASE_URL VAULT_0007_REHEARSAL_NEON_API_KEY
printf 'Rehearsal exit status: %s\n' "$rehearsal_status"
```

Do not put URL/key in command arguments, manifest, shell history, chat, Git, logs or recorded terminals. Do not run the Production CLI against the test branch.

## Preserved protections and limitations

Original SQL SHA-256 and journal checks remain mandatory. The transaction executes unchanged 0007 SQL and its ledger entry, plus the rehearsal-only REVOKE and ACL verification described above. Baseline, privileges, object contracts, fixed lock ordering, statement/network/overall deadlines, bounded rollback/shutdown and uncertain-COMMIT reporting are unchanged. Attempted COMMIT failure always requires read-only investigation, never an automatic retry. No 0008 or app endpoints are called.

Offline tests use synthetic catalogs/provider responses, not PostgreSQL or Neon. They do not establish PostgreSQL 18.6 catalog compatibility, real transport cancellation, live API schema compatibility or permissions. A later separately approved rehearsal is still required. No database, SQL, installer CLI, deployment, commit, push or merge was run in this preparation.
