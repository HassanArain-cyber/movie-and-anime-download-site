# Complete changes for this rehearsal preparation

Baseline: workspace immediately before this request (earlier review files were already untracked).
Production installer changed only by engine extraction; engine body equivalence asserted.

## scripts/migrations/install-0007.mjs

```diff
--- a/scripts/migrations/install-0007.mjs
+++ b/scripts/migrations/install-0007.mjs
@@ -1,3 +1,4 @@
+import { installValidated } from './0007-engine.mjs';
 /** One-shot, approval-gated 0007 installer. Never imports app code or dotenv. */
 import { readFile } from 'node:fs/promises';
 import { createHash } from 'node:crypto';
@@ -150,52 +151,7 @@
 }
 export async function install(rawClient, manifest, sql) {
   validateManifest(manifest);
-  requireThat(createHash('sha256').update(sql).digest('hex') === HASH, 'SQL hash mismatch');
-  const client = boundedClient(rawClient, manifest);
-  let transaction = false;
-  let commitAttempted = false;
-  try {
-    await client.query('BEGIN'); transaction = true;
-    // Startup settings already bound the identity query when using the CLI.
-    const identity = (await client.query(`/* 0007:identity */ SELECT pg_catalog.current_database() AS database,current_user AS role,session_user AS session_role,pg_catalog.current_setting('search_path') AS search_path,pg_catalog.current_setting('server_version_num') AS version,pg_catalog.current_schemas(true) AS schemas,pg_catalog.pg_my_temp_schema()::text AS temp_schema`)).rows[0];
-    requireThat(identity.database === manifest.database && identity.role === manifest.role && identity.session_role === manifest.role && identity.search_path === manifest.originalSearchPath && identity.version === manifest.serverVersionNum && identity.schemas?.[0] === 'pg_catalog' && identity.temp_schema === '0', 'server identity or unsafe login path mismatch');
-    checkResolution((await client.query(RESOLUTION_SQL,[SOURCE_TABLES])).rows,SOURCE_TABLES);
-    await client.query('SET LOCAL search_path = public');
-    await client.query("SET LOCAL lock_timeout = '5s'");
-    await client.query("SET LOCAL idle_in_transaction_session_timeout = '10s'");
-    await client.query("SET LOCAL synchronous_commit = on");
-    await client.query("SELECT set_config('transaction_timeout',$1,true)",[String(Math.max(1,client.remaining()))]);
-    await client.query("SELECT set_config('statement_timeout',$1,true)", [String(manifest.statementTimeoutMs)]);
-    await verifyPrivileges(client);
-    // Inspect the real ledger before reading it or invoking its ID default.
-    await verifyTable(client,'drizzle.__drizzle_migrations',manifest.ledgerOwner);
-    await verifySequence(client,'drizzle.__drizzle_migrations_id_seq','drizzle.__drizzle_migrations',manifest.ledgerOwner,true);
-    // One fixed order: ledger -> media -> seasons -> episodes -> download_links.
-    // No concurrent migration operator is permitted by the approval manifest.
-    await client.query('LOCK TABLE drizzle.__drizzle_migrations IN EXCLUSIVE MODE');
-    await verifyTable(client,'drizzle.__drizzle_migrations',manifest.ledgerOwner);
-    await verifySequence(client,'drizzle.__drizzle_migrations_id_seq','drizzle.__drizzle_migrations',manifest.ledgerOwner,true);
-    checkLedger((await client.query(ledgerSql)).rows);
-    await client.query('LOCK TABLE public.media,public.seasons,public.episodes,public.download_links IN SHARE ROW EXCLUSIVE MODE');
-    await preflight(client);
-    await verifyDefaults(client,manifest);
-    for (const statement of sql.split('--> statement-breakpoint')) {
-      if (statement.trim()) await client.query(statement);
-    }
-    await verifyInstalled(client, sql, manifest);
-    await verifyDefaults(client,manifest);
-    checkLedger((await client.query(ledgerSql)).rows);
-    const recorded = await client.query('INSERT INTO drizzle.__drizzle_migrations (hash,created_at) VALUES ($1,$2) RETURNING id', [HASH, WHEN]);
-    requireThat(recorded.rowCount === 1, 'ledger insert failed');
-    checkLedger((await client.query(ledgerSql)).rows, true);
-    commitAttempted = true;
-    const result = await client.query('COMMIT');
-    insist(result.command==='COMMIT','commit not acknowledged');
-    transaction = false; client.markCommitted();
-  } catch {
-    if (transaction) { try { await client.rollback(); } catch { /* transport gone; never expose provider error */ } }
-    throw new Error(commitAttempted ? 'Commit acknowledgement uncertain. Do not rerun: inspect ledger and objects read-only.' : 'Installation aborted. Confirm rollback and ledger read-only before any retry.');
-  } finally { await client.finish(); }
+  return installValidated(rawClient, manifest, sql);
 }
 export async function main(args = process.argv.slice(2)) {
   requireThat(args.length === 3 && args[0] === '--apply-approved-0007' && args[1] === '--manifest', 'Usage: node scripts/migrations/install-0007.mjs --apply-approved-0007 --manifest /secure/approved.json');
```

## scripts/migrations/0007-engine.mjs

```diff
--- /dev/null
+++ b/scripts/migrations/0007-engine.mjs
@@ -0,0 +1,55 @@
+// Shared transaction engine. Callers must validate their own approval gate first.
+import { createHash } from 'node:crypto';
+import { boundedClient } from './0007-deadline.mjs';
+import { insist, SOURCE_TABLES, RESOLUTION_SQL, checkResolution, verifyTable, verifySequence, verifyPrivileges, verifyDefaults } from './0007-catalog.mjs';
+import { HASH, WHEN, checkLedger, preflight, verifyInstalled } from './install-0007.mjs';
+function requireThat(ok, reason) { if (!ok) throw new Error(reason); }
+const ledgerSql = 'SELECT id,hash,created_at FROM drizzle.__drizzle_migrations ORDER BY id';
+export async function installValidated(rawClient, manifest, sql) {
+  requireThat(createHash('sha256').update(sql).digest('hex') === HASH, 'SQL hash mismatch');
+  const client = boundedClient(rawClient, manifest);
+  let transaction = false;
+  let commitAttempted = false;
+  try {
+    await client.query('BEGIN'); transaction = true;
+    // Startup settings already bound the identity query when using the CLI.
+    const identity = (await client.query(`/* 0007:identity */ SELECT pg_catalog.current_database() AS database,current_user AS role,session_user AS session_role,pg_catalog.current_setting('search_path') AS search_path,pg_catalog.current_setting('server_version_num') AS version,pg_catalog.current_schemas(true) AS schemas,pg_catalog.pg_my_temp_schema()::text AS temp_schema`)).rows[0];
+    requireThat(identity.database === manifest.database && identity.role === manifest.role && identity.session_role === manifest.role && identity.search_path === manifest.originalSearchPath && identity.version === manifest.serverVersionNum && identity.schemas?.[0] === 'pg_catalog' && identity.temp_schema === '0', 'server identity or unsafe login path mismatch');
+    checkResolution((await client.query(RESOLUTION_SQL,[SOURCE_TABLES])).rows,SOURCE_TABLES);
+    await client.query('SET LOCAL search_path = public');
+    await client.query("SET LOCAL lock_timeout = '5s'");
+    await client.query("SET LOCAL idle_in_transaction_session_timeout = '10s'");
+    await client.query("SET LOCAL synchronous_commit = on");
+    await client.query("SELECT set_config('transaction_timeout',$1,true)",[String(Math.max(1,client.remaining()))]);
+    await client.query("SELECT set_config('statement_timeout',$1,true)", [String(manifest.statementTimeoutMs)]);
+    await verifyPrivileges(client);
+    // Inspect the real ledger before reading it or invoking its ID default.
+    await verifyTable(client,'drizzle.__drizzle_migrations',manifest.ledgerOwner);
+    await verifySequence(client,'drizzle.__drizzle_migrations_id_seq','drizzle.__drizzle_migrations',manifest.ledgerOwner,true);
+    // One fixed order: ledger -> media -> seasons -> episodes -> download_links.
+    // No concurrent migration operator is permitted by the approval manifest.
+    await client.query('LOCK TABLE drizzle.__drizzle_migrations IN EXCLUSIVE MODE');
+    await verifyTable(client,'drizzle.__drizzle_migrations',manifest.ledgerOwner);
+    await verifySequence(client,'drizzle.__drizzle_migrations_id_seq','drizzle.__drizzle_migrations',manifest.ledgerOwner,true);
+    checkLedger((await client.query(ledgerSql)).rows);
+    await client.query('LOCK TABLE public.media,public.seasons,public.episodes,public.download_links IN SHARE ROW EXCLUSIVE MODE');
+    await preflight(client);
+    await verifyDefaults(client,manifest);
+    for (const statement of sql.split('--> statement-breakpoint')) {
+      if (statement.trim()) await client.query(statement);
+    }
+    await verifyInstalled(client, sql, manifest);
+    await verifyDefaults(client,manifest);
+    checkLedger((await client.query(ledgerSql)).rows);
+    const recorded = await client.query('INSERT INTO drizzle.__drizzle_migrations (hash,created_at) VALUES ($1,$2) RETURNING id', [HASH, WHEN]);
+    requireThat(recorded.rowCount === 1, 'ledger insert failed');
+    checkLedger((await client.query(ledgerSql)).rows, true);
+    commitAttempted = true;
+    const result = await client.query('COMMIT');
+    insist(result.command==='COMMIT','commit not acknowledged');
+    transaction = false; client.markCommitted();
+  } catch {
+    if (transaction) { try { await client.rollback(); } catch { /* transport gone; never expose provider error */ } }
+    throw new Error(commitAttempted ? 'Commit acknowledgement uncertain. Do not rerun: inspect ledger and objects read-only.' : 'Installation aborted. Confirm rollback and ledger read-only before any retry.');
+  } finally { await client.finish(); }
+}
```

## scripts/migrations/rehearse-0007.mjs

```diff
--- /dev/null
+++ b/scripts/migrations/rehearse-0007.mjs
@@ -0,0 +1,82 @@
+/** Rehearsal ONLY. Importing this module performs no I/O or connections. */
+import { readFile } from 'node:fs/promises';
+import { fileURLToPath } from 'node:url';
+import path from 'node:path';
+import { artifact, HASH, connectionConfig } from './install-0007.mjs';
+import { installValidated } from './0007-engine.mjs';
+import { boundedClient } from './0007-deadline.mjs';
+const insist = (ok, message) => { if (!ok) throw new Error(message); };
+export function validateRehearsal(m) {
+  insist(m.environment === 'rehearsal' && m.branchName === 'test-0007-migration' && m.approvedMigrationHash === HASH, 'rehearsal approval mismatch');
+  for (const key of ['projectId','branchId','endpointId','hostname','database','role','ledgerOwner','originalSearchPath','approvalReference','identityVerifiedAt','backupBranchId','productionBranchId']) {
+    insist(typeof m[key] === 'string' && m[key].trim() === m[key] && m[key].length > 0 && !/[\r\n]/.test(m[key]) && !/REPLACE|EXAMPLE|TODO/i.test(m[key]), 'incomplete rehearsal manifest');
+  }
+  insist([m.branchId,m.backupBranchId,m.productionBranchId].every(id => /^br-[a-z0-9-]+$/.test(id)) && new Set([m.branchId,m.backupBranchId,m.productionBranchId]).size === 3, 'invalid or excluded branch');
+  insist(/^ep-[a-z0-9-]+$/.test(m.endpointId) && m.hostname.startsWith(`${m.endpointId}.`) && /^[a-z0-9.-]+\.neon\.tech$/.test(m.hostname) && !m.hostname.includes('-pooler.'), 'direct endpoint required');
+  insist(Array.isArray(m.excludedEndpointIds) && m.excludedEndpointIds.length >= 2 && m.excludedEndpointIds.every(id => /^ep-[a-z0-9-]+$/.test(id)) && !m.excludedEndpointIds.includes(m.endpointId), 'excluded endpoint');
+  insist(m.serverVersionNum === '180006' && m.port === 5432, 'PostgreSQL 18.6 required');
+  const age = Date.now() - Date.parse(m.identityVerifiedAt);
+  insist(Number.isFinite(age) && age >= 0 && age <= 86400000, 'stale identity review');
+  insist(m.disposableBranchApproved === true && m.maintenanceWindowConfirmed === true && m.applicationSearchPathVerified === true && typeof m.allowPublicFunctionExecute === 'boolean', 'missing rehearsal attestations');
+  // No Production backup/restore evidence is requested, synthesized, or passed through.
+  for (const key of ['backupReference','backupSha256','backupVerifiedAt','restoreVerificationReference']) insist(!(key in m), 'Production evidence does not belong in rehearsal');
+  insist(Number.isInteger(m.overallTimeoutMs) && m.overallTimeoutMs >= 1000 && m.overallTimeoutMs <= 600000, 'invalid overall deadline');
+  insist(Number.isInteger(m.networkTimeoutMs) && m.networkTimeoutMs >= 1000 && m.networkTimeoutMs <= m.overallTimeoutMs, 'invalid network deadline');
+  insist(Number.isInteger(m.cleanupTimeoutMs) && m.cleanupTimeoutMs >= 1000 && m.cleanupTimeoutMs <= 10000, 'invalid cleanup deadline');
+  insist(Number.isInteger(m.statementTimeoutMs) && m.statementTimeoutMs >= 1000 && m.statementTimeoutMs <= 1800000 && m.statementTimeoutMs < m.networkTimeoutMs && m.statementTimeoutMs <= m.overallTimeoutMs, 'invalid statement deadline');
+  return m;
+}
+export function rehearsalConfig(env, m) {
+  validateRehearsal(m);
+  insist(typeof env.VAULT_0007_REHEARSAL_DATABASE_URL === 'string' && env.VAULT_0007_REHEARSAL_DATABASE_URL.length > 0, 'rehearsal URL required');
+  return { ...connectionConfig(env.VAULT_0007_REHEARSAL_DATABASE_URL, m), application_name: 'vault-rehearsal-0007' };
+}
+// Provider identity cannot be proven by current_database() or a branch name alone.
+// Read-only control-plane GETs only; no SQL and no requests to database endpoints.
+export async function verifyProvider(m, token, fetcher = fetch) {
+  validateRehearsal(m);
+  insist(typeof token === 'string' && token.length > 0 && !/[\r\n]/.test(token), 'Neon read-only API credential required');
+  async function get(suffix) {
+    const response = await fetcher(`https://console.neon.tech/api/v2/projects/${encodeURIComponent(m.projectId)}/${suffix}`, {
+      method: 'GET', redirect: 'error', headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000),
+    });
+    insist(response.ok, 'provider verification failed');
+    return response.json();
+  }
+  const [target, backup, production, result] = await Promise.all([
+    get(`branches/${encodeURIComponent(m.branchId)}`),
+    get(`branches/${encodeURIComponent(m.backupBranchId)}`),
+    get(`branches/${encodeURIComponent(m.productionBranchId)}`), get('endpoints'),
+  ]);
+  insist(target.branch?.id === m.branchId && target.branch.name === 'test-0007-migration' && target.branch.parent_id === m.backupBranchId && target.branch.default === false, 'wrong actual branch or provenance');
+  insist(backup.branch?.id === m.backupBranchId && backup.branch.name === 'pre-0007-migration-backup' && production.branch?.id === m.productionBranchId && production.branch.default === true, 'excluded branch identity mismatch');
+  insist(Array.isArray(result.endpoints) && !result.pagination?.next_cursor, 'incomplete endpoint inventory');
+  const endpoint = result.endpoints.filter(e => e.id === m.endpointId);
+  insist(endpoint.length === 1 && endpoint[0].branch_id === m.branchId && endpoint[0].host === m.hostname && endpoint[0].type === 'read_write', 'wrong actual endpoint');
+  const excluded = result.endpoints.filter(e => [m.backupBranchId,m.productionBranchId].includes(e.branch_id));
+  insist(excluded.some(e => e.branch_id === m.backupBranchId) && excluded.some(e => e.branch_id === m.productionBranchId) && excluded.every(e => m.excludedEndpointIds.includes(e.id)) && !excluded.some(e => e.id === m.endpointId || e.host === m.hostname), 'excluded endpoint inventory mismatch');
+}
+export async function installRehearsal(client, manifest, sql) {
+  validateRehearsal(manifest);
+  return installValidated(client, manifest, sql);
+}
+export async function main(args = process.argv.slice(2)) {
+  insist(args.length === 3 && args[0] === '--apply-disposable-rehearsal-0007' && args[1] === '--manifest', 'explicit rehearsal flag required');
+  const sql = await artifact();
+  const m = validateRehearsal(JSON.parse(await readFile(args[2], 'utf8')));
+  const config = rehearsalConfig(process.env, m);
+  await verifyProvider(m, process.env.VAULT_0007_REHEARSAL_NEON_API_KEY);
+  const { Client } = await import('pg');
+  const client = new Client(config);
+  client.on('error', () => {});
+  try { await client.connect(); }
+  catch { await boundedClient(client,m).finish(); throw new Error('CONNECTION_FAILED'); }
+  await installRehearsal(client,m,sql);
+  console.log('Disposable rehearsal 0007 committed and ledger verified. No Production approval implied.');
+}
+if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
+  main().catch(e => {
+    console.error(e?.message?.startsWith('Commit acknowledgement uncertain.') ? e.message : 'Rehearsal stopped. No credentials or provider details printed. If connected, verify rollback and ledger read-only before retry.');
+    process.exitCode = 1;
+  });
+}
```

## tests/rehearse-0007.test.mjs

```diff
--- /dev/null
+++ b/tests/rehearse-0007.test.mjs
@@ -0,0 +1,40 @@
+// Offline only: injected provider responses and synthetic pg client; no network.
+import test from 'node:test';
+import assert from 'node:assert/strict';
+import { artifact, validateManifest } from '../scripts/migrations/install-0007.mjs';
+import { validateRehearsal, rehearsalConfig, verifyProvider, installRehearsal, main } from '../scripts/migrations/rehearse-0007.mjs';
+import { manifest, fake } from './fixtures/0007-offline.mjs';
+function review() {
+ const m={...manifest(),environment:'rehearsal',branchName:'test-0007-migration',branchId:'br-test',endpointId:'ep-test',hostname:'ep-test.us-east-2.aws.neon.tech',backupBranchId:'br-backup',productionBranchId:'br-production',excludedEndpointIds:['ep-backup','ep-production'],disposableBranchApproved:true};
+ for(const k of ['backupReference','backupSha256','backupVerifiedAt','restoreVerificationReference']) delete m[k];
+ return m;
+}
+const url=m=>`postgresql://${m.role}:synthetic@${m.hostname}/${m.database}`;
+const env=m=>({VAULT_0007_REHEARSAL_DATABASE_URL:url(m)});
+function provider(m, mutate=()=>{}) {
+ const data={target:{branch:{id:m.branchId,name:m.branchName,parent_id:m.backupBranchId,default:false}},backup:{branch:{id:m.backupBranchId,name:'pre-0007-migration-backup'}},production:{branch:{id:m.productionBranchId,default:true}},endpoints:{endpoints:[{id:m.endpointId,branch_id:m.branchId,host:m.hostname,type:'read_write'},...['backup','production'].map(x=>({id:`ep-${x}`,branch_id:`br-${x}`,host:`ep-${x}.us-east-2.aws.neon.tech`}))]}};
+ mutate(data);
+ return async (address,options)=>{assert.equal(options.method,'GET');assert.equal(options.redirect,'error');const key=address.endsWith('/endpoints')?'endpoints':address.endsWith('/br-test')?'target':address.endsWith('/br-backup')?'backup':'production';return {ok:true,json:async()=>data[key]};};
+}
+test('separate environment, flag and secret; no generic or Production fallback',async()=>{
+ const m=review();assert.ok(validateRehearsal(m));assert.throws(()=>validateManifest(m));assert.throws(()=>validateRehearsal(manifest()));
+ for(const e of [{DATABASE_URL:url(m)},{VAULT_0007_DATABASE_URL:url(m)},{}]) assert.throws(()=>rehearsalConfig(e,m));
+ await assert.rejects(main(['--apply-approved-0007','--manifest','not-read']));
+ assert.throws(()=>validateRehearsal({...m,backupReference:'invented'}));
+});
+test('wrong manifest branch, endpoint, pooler and PostgreSQL version rejected',()=>{
+ const m=review();for(const change of [{branchName:'production'},{branchId:m.backupBranchId},{branchId:m.productionBranchId},{endpointId:'ep-production'},{hostname:m.hostname.replace('ep-test.','ep-test-pooler.')},{serverVersionNum:'180005'},{serverVersionNum:'180007'},{serverVersionNum:'170006'}]) assert.throws(()=>validateRehearsal({...m,...change}));
+});
+for(const [name,change] of [['endpoint',m=>({...m,hostname:'ep-other.us-east-2.aws.neon.tech'})],['database',m=>({...m,database:'other'})],['role',m=>({...m,role:'other'})]]) test(`wrong URL ${name} rejected`,()=>{const m=review();assert.throws(()=>rehearsalConfig({VAULT_0007_REHEARSAL_DATABASE_URL:url(change(m))},m));assert.ok(rehearsalConfig(env(m),m).ssl.rejectUnauthorized);});
+test('actual provider branch, parent, endpoint, hostname and exclusions verified offline',async()=>{
+ const m=review();await verifyProvider(m,'synthetic',provider(m));
+ for(const mutate of [d=>{d.target.branch.id='br-wrong';},d=>{d.target.branch.name='production';},d=>{d.target.branch.parent_id='br-other';},d=>{d.endpoints.endpoints[0].branch_id=m.productionBranchId;},d=>{d.endpoints.endpoints[0].id='ep-other';},d=>{d.endpoints.endpoints[0].host='other';},d=>{d.endpoints.endpoints[1].id='ep-unlisted';},d=>{d.production.branch.default=false;}]) await assert.rejects(verifyProvider(m,'synthetic',provider(m,mutate)));
+});
+test('shared engine accepts rehearsal and rejects actual database, role, version before migration',async()=>{
+ const m=review(),sql=await artifact();await installRehearsal(fake(sql,m),m,sql);
+ for(const [field,value] of [['database','wrong'],['role','wrong'],['session_role','wrong'],['version','180005']]) {
+  const client=fake(sql,m,({label,result})=>{if(label==='identity')result.rows[0][field]=value;});
+  await assert.rejects(installRehearsal(client,m,sql));assert.ok(client.calls.some(c=>c.text==='ROLLBACK'));assert.ok(!client.calls.some(c=>c.text===sql.split('--> statement-breakpoint')[0]));
+ }
+});
+test('shared engine still rejects altered immutable SQL',async()=>{const m=review(),sql=await artifact(),client=fake(sql,m);await assert.rejects(installRehearsal(client,m,sql+' '));assert.equal(client.calls.length,0);});
```

## docs/rehearsal-0007-installer.md

```diff
--- /dev/null
+++ b/docs/rehearsal-0007-installer.md
@@ -0,0 +1,82 @@
+# Disposable 0007 rehearsal — PREPARED, NOT EXECUTED
+
+Only `test-0007-migration`, with parent `pre-0007-migration-backup`, is permitted. This run commits on the disposable branch. It does not approve Production execution. No connection or provider request was made during preparation.
+
+## Structural change
+
+The Production CLI, validator, secret name and approval flag are unchanged. Its `install()` validates the original Production manifest and delegates to `0007-engine.mjs`. The engine is the previous transaction function verbatim except removal of the Production-specific validation call (now performed by each wrapper). Both wrappers use the existing catalog and deadline helpers. Production backup and restore requirements are not relaxed. The Production source file necessarily has a mechanical import/wrapper change; it is not byte-identical.
+
+## Identity gates
+
+The rehearsal CLI requires `--apply-disposable-rehearsal-0007`, `environment: "rehearsal"`, the exact branch name, version `180006`, and a dedicated URL. No `DATABASE_URL` or Production-secret fallback exists. TLS hostname/certificate verification is mandatory; poolers are rejected.
+
+Before opening PostgreSQL, read-only Neon API GETs verify the pinned project branch IDs, test name, parent ID, non-default test status, backup name, Production default status, and direct read-write endpoint ID/host/branch mapping. All Production/backup endpoints in the returned inventory must be explicitly excluded. These are control-plane metadata reads, not SQL connections to those branches. No control-plane mutation is implemented. The operator must approve these metadata reads as part of any future execution. If those reads are not authorized, do not run.
+
+This API check needs a separately supplied Neon API credential with only the necessary read access. Never paste it into chat. The current Arena host allowlist does not include `console.neon.tech`; future execution must occur in an approved environment with access to it and the test PostgreSQL endpoint. Do not bypass network policy. If provider response fields differ or evidence is incomplete, stop; never guess IDs or disable checks. No API behavior has been live-tested.
+
+SQL cannot prove a Neon branch ID. The control plane proves the routing mapping, verified TLS binds the URL host, and the transaction identity query independently checks actual database, login/current role, exact version, search path and temporary schema before migration SQL. No role/grant creation or repair is implemented. The reviewed role must already have all required privileges.
+
+## Credential-free manifest
+
+Create `/secure/0007-rehearsal.json` outside Git after obtaining actual non-secret IDs and reviewing the role, path, ledger owner and ACL policy. The following is a template, NOT valid approval evidence. Replace every placeholder with truthful reviewed values. Do not copy Production backup/restore attestations into it.
+
+```json
+{
+  "environment": "rehearsal",
+  "branchName": "test-0007-migration",
+  "approvedMigrationHash": "d6c108d47c5c45a4ff16b17ea5e07ca45f2c71b7d1e1a851a5d7143fb3c14666",
+  "projectId": "REPLACE",
+  "branchId": "REPLACE",
+  "backupBranchId": "REPLACE",
+  "productionBranchId": "REPLACE",
+  "endpointId": "REPLACE",
+  "hostname": "REPLACE",
+  "excludedEndpointIds": ["REPLACE", "REPLACE"],
+  "port": 5432,
+  "database": "REPLACE",
+  "role": "REPLACE",
+  "ledgerOwner": "REPLACE",
+  "originalSearchPath": "REPLACE",
+  "serverVersionNum": "180006",
+  "approvalReference": "REPLACE",
+  "identityVerifiedAt": "REPLACE",
+  "disposableBranchApproved": true,
+  "maintenanceWindowConfirmed": true,
+  "applicationSearchPathVerified": true,
+  "allowPublicFunctionExecute": false,
+  "statementTimeoutMs": 60000,
+  "networkTimeoutMs": 65000,
+  "overallTimeoutMs": 300000,
+  "cleanupTimeoutMs": 3000
+}
+```
+
+The booleans are not evidence: set them truthfully only after review. `allowPublicFunctionExecute` must reflect the reviewed default ACL policy. The identity review must be less than 24 hours old. Branch names supplied so far are user-reported; actual IDs, host, role, database, defaults and server version remain unverified.
+
+## Exact FUTURE command — DO NOT RUN without separate execution approval
+
+Requires the repository's pinned `pg` dependency installed. In an unrecorded trusted Bash terminal (environment secrets can still be inspected by privileged local processes):
+
+```bash
+set +x
+read -r -s -p 'Disposable test-0007-migration DIRECT URL: ' VAULT_0007_REHEARSAL_DATABASE_URL
+printf '\n'
+read -r -s -p 'Neon read-only API key: ' VAULT_0007_REHEARSAL_NEON_API_KEY
+printf '\n'
+export VAULT_0007_REHEARSAL_DATABASE_URL VAULT_0007_REHEARSAL_NEON_API_KEY
+(
+  trap 'unset VAULT_0007_REHEARSAL_DATABASE_URL VAULT_0007_REHEARSAL_NEON_API_KEY' EXIT
+  node scripts/migrations/rehearse-0007.mjs --apply-disposable-rehearsal-0007 --manifest /secure/0007-rehearsal.json
+)
+rehearsal_status=$?
+unset VAULT_0007_REHEARSAL_DATABASE_URL VAULT_0007_REHEARSAL_NEON_API_KEY
+printf 'Rehearsal exit status: %s\n' "$rehearsal_status"
+```
+
+Do not put URL/key in command arguments, manifest, shell history, chat, Git, logs or recorded terminals. Do not run the Production CLI against the test branch.
+
+## Preserved protections and limitations
+
+Original SQL SHA-256 and journal checks remain mandatory. Only unchanged 0007 SQL and its ledger entry execute in the shared transaction. Baseline, privileges, object contracts, fixed lock ordering, statement/network/overall deadlines, bounded rollback/shutdown and uncertain-COMMIT reporting are unchanged. Attempted COMMIT failure always requires read-only investigation, never an automatic retry. No 0008 or app endpoints are called.
+
+Offline tests use synthetic catalogs/provider responses, not PostgreSQL or Neon. They do not establish PostgreSQL 18.6 catalog compatibility, real transport cancellation, live API schema compatibility or permissions. A later separately approved rehearsal is still required. No database, SQL, installer CLI, deployment, commit, push or merge was run in this preparation.
```

## Complete offline test output

```text
TAP version 13
# Subtest: exact hash; breakpoint split reconstructs bytes and preserves entire function
ok 1 - exact hash; breakpoint split reconstructs bytes and preserves entire function
  ---
  duration_ms: 0.869054
  type: 'test'
  ...
# Subtest: manifest requires reviewed ACL/owner and bounded PG17/18 execution policy
ok 2 - manifest requires reviewed ACL/owner and bounded PG17/18 execution policy
  ---
  duration_ms: 1.140765
  type: 'test'
  ...
# Subtest: URL identity exact; verified TLS and bounded startup settings
ok 3 - URL identity exact; verified TLS and bounded startup settings
  ---
  duration_ms: 0.490147
  type: 'test'
  ...
# Subtest: all seven ledger rows exact; extra/missing/mismatched rows rejected
ok 4 - all seven ledger rows exact; extra/missing/mismatched rows rejected
  ---
  duration_ms: 0.395533
  type: 'test'
  ...
# Subtest: exact columns/defaults/not-null drizzle.__drizzle_migrations
ok 5 - exact columns/defaults/not-null drizzle.__drizzle_migrations
  ---
  duration_ms: 0.363916
  type: 'test'
  ...
# Subtest: exact constraints drizzle.__drizzle_migrations
ok 6 - exact constraints drizzle.__drizzle_migrations
  ---
  duration_ms: 0.285976
  type: 'test'
  ...
# Subtest: exact indexes drizzle.__drizzle_migrations
ok 7 - exact indexes drizzle.__drizzle_migrations
  ---
  duration_ms: 0.303651
  type: 'test'
  ...
# Subtest: exact columns/defaults/not-null public.subscribers
ok 8 - exact columns/defaults/not-null public.subscribers
  ---
  duration_ms: 0.139235
  type: 'test'
  ...
# Subtest: exact constraints public.subscribers
ok 9 - exact constraints public.subscribers
  ---
  duration_ms: 0.199819
  type: 'test'
  ...
# Subtest: exact indexes public.subscribers
ok 10 - exact indexes public.subscribers
  ---
  duration_ms: 0.331644
  type: 'test'
  ...
# Subtest: exact columns/defaults/not-null public.anime_follows
ok 11 - exact columns/defaults/not-null public.anime_follows
  ---
  duration_ms: 0.852719
  type: 'test'
  ...
# Subtest: exact constraints public.anime_follows
ok 12 - exact constraints public.anime_follows
  ---
  duration_ms: 0.414275
  type: 'test'
  ...
# Subtest: exact indexes public.anime_follows
ok 13 - exact indexes public.anime_follows
  ---
  duration_ms: 0.186115
  type: 'test'
  ...
# Subtest: exact columns/defaults/not-null public.episode_publications
ok 14 - exact columns/defaults/not-null public.episode_publications
  ---
  duration_ms: 0.068997
  type: 'test'
  ...
# Subtest: exact constraints public.episode_publications
ok 15 - exact constraints public.episode_publications
  ---
  duration_ms: 0.137959
  type: 'test'
  ...
# Subtest: exact indexes public.episode_publications
ok 16 - exact indexes public.episode_publications
  ---
  duration_ms: 0.236799
  type: 'test'
  ...
# Subtest: exact columns/defaults/not-null public.episode_notifications
ok 17 - exact columns/defaults/not-null public.episode_notifications
  ---
  duration_ms: 0.071057
  type: 'test'
  ...
# Subtest: exact constraints public.episode_notifications
ok 18 - exact constraints public.episode_notifications
  ---
  duration_ms: 0.198462
  type: 'test'
  ...
# Subtest: exact indexes public.episode_notifications
ok 19 - exact indexes public.episode_notifications
  ---
  duration_ms: 0.192813
  type: 'test'
  ...
# Subtest: PG18 NOT NULL catalog entries explicitly separated from PK/FK/CHECK; canonical CHECK accepted
ok 20 - PG18 NOT NULL catalog entries explicitly separated from PK/FK/CHECK; canonical CHECK accepted
  ---
  duration_ms: 0.143812
  type: 'test'
  ...
# Subtest: sequence type/options/default dependency/ownership/privileges exact
ok 21 - sequence type/options/default dependency/ownership/privileges exact
  ---
  duration_ms: 0.258553
  type: 'test'
  ...
# Subtest: ACLs reject unrelated roles, PUBLIC table/sequence grants, grant options and incomplete owner grants
ok 22 - ACLs reject unrelated roles, PUBLIC table/sequence grants, grant options and incomplete owner grants
  ---
  duration_ms: 0.439709
  type: 'test'
  ...
# Subtest: application resolution checks every requested relation; null/shadowing/missing entries fail
ok 23 - application resolution checks every requested relation; null/shadowing/missing entries fail
  ---
  duration_ms: 0.114244
  type: 'test'
  ...
# Subtest: success executes unchanged SQL with one transaction, preflight before DDL, exact ledger pair and bounded shutdown
ok 24 - success executes unchanged SQL with one transaction, preflight before DDL, exact ledger pair and bounded shutdown
  ---
  duration_ms: 9.657852
  type: 'test'
  ...
# Subtest: abort and rollback: wrong database
ok 25 - abort and rollback: wrong database
  ---
  duration_ms: 0.543566
  type: 'test'
  ...
# Subtest: abort and rollback: unsafe builtin path
ok 26 - abort and rollback: unsafe builtin path
  ---
  duration_ms: 0.215199
  type: 'test'
  ...
# Subtest: abort and rollback: temporary schema
ok 27 - abort and rollback: temporary schema
  ---
  duration_ms: 0.24274
  type: 'test'
  ...
# Subtest: abort and rollback: ledger default
ok 28 - abort and rollback: ledger default
  ---
  duration_ms: 0.424391
  type: 'test'
  ...
# Subtest: abort and rollback: ledger owner
ok 29 - abort and rollback: ledger owner
  ---
  duration_ms: 0.500264
  type: 'test'
  ...
# Subtest: abort and rollback: sequence behind
ok 30 - abort and rollback: sequence behind
  ---
  duration_ms: 4.402823
  type: 'test'
  ...
# Subtest: abort and rollback: source resolution
ok 31 - abort and rollback: source resolution
  ---
  duration_ms: 0.331676
  type: 'test'
  ...
# Subtest: abort and rollback: missing install privilege
ok 32 - abort and rollback: missing install privilege
  ---
  duration_ms: 1.957503
  type: 'test'
  ...
# Subtest: abort and rollback: partial standalone type
ok 33 - abort and rollback: partial standalone type
  ---
  duration_ms: 0.998425
  type: 'test'
  ...
# Subtest: abort and rollback: PUBLIC table default ACL
ok 34 - abort and rollback: PUBLIC table default ACL
  ---
  duration_ms: 2.669653
  type: 'test'
  ...
# Subtest: abort and rollback: existing rule
ok 35 - abort and rollback: existing rule
  ---
  duration_ms: 0.852169
  type: 'test'
  ...
# Subtest: abort and rollback: existing trigger
ok 36 - abort and rollback: existing trigger
  ---
  duration_ms: 0.86215
  type: 'test'
  ...
# Subtest: abort and rollback: event trigger
ok 37 - abort and rollback: event trigger
  ---
  duration_ms: 0.563529
  type: 'test'
  ...
# Subtest: abort and rollback: ledger mismatch
ok 38 - abort and rollback: ledger mismatch
  ---
  duration_ms: 0.543091
  type: 'test'
  ...
# Subtest: abort and rollback: post-install constraint action
ok 39 - abort and rollback: post-install constraint action
  ---
  duration_ms: 1.110706
  type: 'test'
  ...
# Subtest: abort and rollback: post-install UPDATE OF columns
ok 40 - abort and rollback: post-install UPDATE OF columns
  ---
  duration_ms: 2.054581
  type: 'test'
  ...
# Subtest: abort and rollback: post-install function security definer
ok 41 - abort and rollback: post-install function security definer
  ---
  duration_ms: 1.201231
  type: 'test'
  ...
# Subtest: abort and rollback: post-install external grant
ok 42 - abort and rollback: post-install external grant
  ---
  duration_ms: 0.906112
  type: 'test'
  ...
# Subtest: abort and rollback: post-install sequence ownership
ok 43 - abort and rollback: post-install sequence ownership
  ---
  duration_ms: 1.977323
  type: 'test'
  ...
# Subtest: abort and rollback: ledger insert error
ok 44 - abort and rollback: ledger insert error
  ---
  duration_ms: 1.313529
  type: 'test'
  ...
# Subtest: corrupt SQL and invalid manifest rejected before BEGIN
ok 45 - corrupt SQL and invalid manifest rejected before BEGIN
  ---
  duration_ms: 0.191569
  type: 'test'
  ...
# Subtest: COMMIT errors or ROLLBACK command acknowledgement explicitly uncertain
ok 46 - COMMIT errors or ROLLBACK command acknowledgement explicitly uncertain
  ---
  duration_ms: 6.242444
  type: 'test'
  ...
# Subtest: client query timeout closes transport, never reuses socket for ROLLBACK
ok 47 - client query timeout closes transport, never reuses socket for ROLLBACK
  ---
  duration_ms: 8.608413
  type: 'test'
  ...
# Subtest: overall deadline rejects next operation without sending query
ok 48 - overall deadline rejects next operation without sending query
  ---
  duration_ms: 0.146542
  type: 'test'
  ...
# Subtest: rollback and client shutdown have finite cleanup deadlines
ok 49 - rollback and client shutdown have finite cleanup deadlines
  ---
  duration_ms: 5.226213
  type: 'test'
  ...
# Subtest: schema-specific default ACL grants cannot bypass global restrictions
ok 50 - schema-specific default ACL grants cannot bypass global restrictions
  ---
  duration_ms: 0.12334
  type: 'test'
  ...
# Subtest: all required installation privileges individually fail closed
ok 51 - all required installation privileges individually fail closed
  ---
  duration_ms: 3.526687
  type: 'test'
  ...
# Subtest: separate environment, flag and secret; no generic or Production fallback
ok 52 - separate environment, flag and secret; no generic or Production fallback
  ---
  duration_ms: 1.639523
  type: 'test'
  ...
# Subtest: wrong manifest branch, endpoint, pooler and PostgreSQL version rejected
ok 53 - wrong manifest branch, endpoint, pooler and PostgreSQL version rejected
  ---
  duration_ms: 1.277819
  type: 'test'
  ...
# Subtest: wrong URL endpoint rejected
ok 54 - wrong URL endpoint rejected
  ---
  duration_ms: 0.387738
  type: 'test'
  ...
# Subtest: wrong URL database rejected
ok 55 - wrong URL database rejected
  ---
  duration_ms: 0.151841
  type: 'test'
  ...
# Subtest: wrong URL role rejected
ok 56 - wrong URL role rejected
  ---
  duration_ms: 0.171553
  type: 'test'
  ...
# Subtest: actual provider branch, parent, endpoint, hostname and exclusions verified offline
ok 57 - actual provider branch, parent, endpoint, hostname and exclusions verified offline
  ---
  duration_ms: 1.376356
  type: 'test'
  ...
# Subtest: shared engine accepts rehearsal and rejects actual database, role, version before migration
ok 58 - shared engine accepts rehearsal and rejects actual database, role, version before migration
  ---
  duration_ms: 15.337479
  type: 'test'
  ...
# Subtest: shared engine still rejects altered immutable SQL
ok 59 - shared engine still rejects altered immutable SQL
  ---
  duration_ms: 4.526533
  type: 'test'
  ...
1..59
# tests 59
# suites 0
# pass 59
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 182.883929
```
