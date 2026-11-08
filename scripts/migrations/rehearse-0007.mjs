/** Rehearsal ONLY. Importing this module performs no I/O or connections. */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { artifact, HASH, connectionConfig } from './install-0007.mjs';
import { installValidated } from './0007-engine.mjs';
import { boundedClient } from './0007-deadline.mjs';
const insist = (ok, message) => { if (!ok) throw new Error(message); };
export function validateRehearsal(m) {
  insist(m.environment === 'rehearsal' && m.branchName === 'test-0007-migration' && m.approvedMigrationHash === HASH, 'rehearsal approval mismatch');
  for (const key of ['projectId','branchId','endpointId','hostname','database','role','ledgerOwner','originalSearchPath','approvalReference','identityVerifiedAt','backupBranchId','productionBranchId']) {
    insist(typeof m[key] === 'string' && m[key].trim() === m[key] && m[key].length > 0 && !/[\r\n]/.test(m[key]) && !/REPLACE|EXAMPLE|TODO/i.test(m[key]), 'incomplete rehearsal manifest');
  }
  insist([m.branchId,m.backupBranchId,m.productionBranchId].every(id => /^br-[a-z0-9-]+$/.test(id)) && new Set([m.branchId,m.backupBranchId,m.productionBranchId]).size === 3, 'invalid or excluded branch');
  insist(/^ep-[a-z0-9-]+$/.test(m.endpointId) && m.hostname.startsWith(`${m.endpointId}.`) && /^[a-z0-9.-]+\.neon\.tech$/.test(m.hostname) && !m.hostname.includes('-pooler.'), 'direct endpoint required');
  insist(Array.isArray(m.excludedEndpointIds) && m.excludedEndpointIds.length >= 2 && m.excludedEndpointIds.every(id => /^ep-[a-z0-9-]+$/.test(id)) && !m.excludedEndpointIds.includes(m.endpointId), 'excluded endpoint');
  const inventoryIds = [m.endpointId, ...m.excludedEndpointIds];
  insist(new Set(inventoryIds).size === inventoryIds.length, 'duplicate endpoint approval');
  insist(m.endpointBranchNames && typeof m.endpointBranchNames === 'object' && !Array.isArray(m.endpointBranchNames)
    && Object.keys(m.endpointBranchNames).length === inventoryIds.length
    && inventoryIds.every(id => Object.hasOwn(m.endpointBranchNames,id)
      && typeof m.endpointBranchNames[id] === 'string' && m.endpointBranchNames[id].trim().length > 0
      && !/[\r\n]/.test(m.endpointBranchNames[id]))
    && m.endpointBranchNames[m.endpointId] === m.branchName, 'complete endpoint branch-name approval required');
  insist(m.serverVersionNum === '180006' && m.port === 5432, 'PostgreSQL 18.6 required');
  const age = Date.now() - Date.parse(m.identityVerifiedAt);
  insist(Number.isFinite(age) && age >= 0 && age <= 86400000, 'stale identity review');
  insist(m.disposableBranchApproved === true && m.maintenanceWindowConfirmed === true && m.applicationSearchPathVerified === true && m.allowPublicFunctionExecute === false && m.role === 'neondb_owner', 'missing rehearsal attestations');
  // No Production backup/restore evidence is requested, synthesized, or passed through.
  for (const key of ['backupReference','backupSha256','backupVerifiedAt','restoreVerificationReference']) insist(!(key in m), 'Production evidence does not belong in rehearsal');
  insist(Number.isInteger(m.overallTimeoutMs) && m.overallTimeoutMs >= 1000 && m.overallTimeoutMs <= 600000, 'invalid overall deadline');
  insist(Number.isInteger(m.networkTimeoutMs) && m.networkTimeoutMs >= 1000 && m.networkTimeoutMs <= m.overallTimeoutMs, 'invalid network deadline');
  insist(Number.isInteger(m.cleanupTimeoutMs) && m.cleanupTimeoutMs >= 1000 && m.cleanupTimeoutMs <= 10000, 'invalid cleanup deadline');
  insist(Number.isInteger(m.statementTimeoutMs) && m.statementTimeoutMs >= 1000 && m.statementTimeoutMs <= 1800000 && m.statementTimeoutMs < m.networkTimeoutMs && m.statementTimeoutMs <= m.overallTimeoutMs, 'invalid statement deadline');
  return m;
}
export function rehearsalConfig(env, m) {
  validateRehearsal(m);
  insist(typeof env.VAULT_0007_REHEARSAL_DATABASE_URL === 'string' && env.VAULT_0007_REHEARSAL_DATABASE_URL.length > 0, 'rehearsal URL required');
  return { ...connectionConfig(env.VAULT_0007_REHEARSAL_DATABASE_URL, m), application_name: 'vault-rehearsal-0007' };
}
// Provider identity cannot be proven by current_database() or a branch name alone.
// Read-only control-plane GETs only; no SQL and no requests to database endpoints.
export async function verifyProvider(m, token, fetcher = fetch) {
  validateRehearsal(m);
  insist(typeof token === 'string' && token.length > 0 && !/[\r\n]/.test(token), 'Neon read-only API credential required');
  async function get(suffix) {
    const response = await fetcher(`https://console.neon.tech/api/v2/projects/${encodeURIComponent(m.projectId)}/${suffix}`, {
      method: 'GET', redirect: 'error', headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000),
    });
    insist(response.ok, 'provider verification failed');
    return response.json();
  }
  const [target, backup, production, result] = await Promise.all([
    get(`branches/${encodeURIComponent(m.branchId)}`),
    get(`branches/${encodeURIComponent(m.backupBranchId)}`),
    get(`branches/${encodeURIComponent(m.productionBranchId)}`), get('endpoints'),
  ]);
  insist(target.branch?.id === m.branchId && target.branch.name === 'test-0007-migration' && target.branch.parent_id === m.backupBranchId && target.branch.default === false, 'wrong actual branch or provenance');
  insist(backup.branch?.id === m.backupBranchId && backup.branch.name === 'pre-0007-migration-backup' && production.branch?.id === m.productionBranchId && production.branch.default === true, 'excluded branch identity mismatch');
  insist(Array.isArray(result.endpoints), 'incomplete endpoint inventory');
  // Fail closed on continuation indicators, unknown pagination shapes, or a
  // declared total inconsistent with the returned complete inventory.
  if (result.pagination != null) {
    const p = result.pagination;
    insist(typeof p === 'object' && !Array.isArray(p)
      && Object.keys(p).every(k => ['next_cursor','cursor','has_more','total'].includes(k))
      && !p.next_cursor && !p.cursor && !p.has_more
      && (p.total == null || p.total === result.endpoints.length), 'incomplete or paginated endpoint inventory');
  }
  insist(!result.next_cursor && !result.next_page && !result.has_more
    && (result.total == null || result.total === result.endpoints.length), 'incomplete endpoint inventory');
  const approvedIds = [m.endpointId, ...m.excludedEndpointIds];
  insist(result.endpoints.length === approvedIds.length
    && new Set(result.endpoints.map(e => e?.id)).size === approvedIds.length
    && result.endpoints.every(e => e && approvedIds.includes(e.id)
      && /^br-[a-z0-9-]+$/.test(e.branch_id)
      && (e.id !== m.endpointId || (typeof e.host === 'string' && e.host.startsWith(`${e.id}.`)
        && /^[a-z0-9.-]+\.neon\.tech$/.test(e.host) && !e.host.includes('-pooler.')))),
    'endpoint inventory must exactly match approvals');
  if (m.endpointTypes?.[m.endpointId]) insist(result.endpoints.find(e=>e.id===m.endpointId)?.type===m.endpointTypes[m.endpointId], 'confirmed endpoint type mismatch');
  const endpoint = result.endpoints.find(e => e.id === m.endpointId);
  insist(endpoint.branch_id === m.branchId && endpoint.host === m.hostname && endpoint.type === 'read_write', 'wrong actual endpoint');
  const excluded = result.endpoints.filter(e => e.id !== m.endpointId);
  insist(excluded.every(e => e.branch_id !== m.branchId && e.host !== m.hostname)
    && excluded.some(e => e.branch_id === m.backupBranchId)
    && excluded.some(e => e.branch_id === m.productionBranchId), 'excluded endpoint branch mismatch');
  const branches = new Map([[m.branchId,target.branch],[m.backupBranchId,backup.branch],[m.productionBranchId,production.branch]]);
  // Only three branch identities are relevant to authorization. Other known
  // endpoint->branch IDs remain exclusion guards, not new metadata tasks.
  if (m.branchInventory) {
    for (const id of [m.branchId,m.backupBranchId,m.productionBranchId]) {
      const expected=m.branchInventory.find(b=>b.id===id),actual=branches.get(id);
      insist(expected && actual?.project_id===m.projectId && actual.name===expected.name
        && (!expected.parent_verified || actual.parent_id===expected.parent_id)
        && (expected.default===null || actual.default===expected.default), 'approved branch hierarchy mismatch');
    }
    insist(result.endpoints.every(e=>e.branch_id===m.endpointBranchIds?.[e.id]), 'approved endpoint branch ID mismatch');
  } else {
    insist(result.endpoints.every(e=>branches.get(e.branch_id)?.project_id===m.projectId
      && branches.get(e.branch_id)?.name===m.endpointBranchNames[e.id]), 'endpoint branch mapping mismatch');
  }

}
export async function installRehearsal(client, manifest, sql) {
  validateRehearsal(manifest);
  return installValidated(client, manifest, sql);
}
export async function main(args = process.argv.slice(2)) {
  insist(args.length === 3 && args[0] === '--apply-disposable-rehearsal-0007' && args[1] === '--manifest', 'explicit rehearsal flag required');
  const sql = await artifact();
  const m = validateRehearsal(JSON.parse(await readFile(args[2], 'utf8')));
  const config = rehearsalConfig(process.env, m);
  await verifyProvider(m, process.env.VAULT_0007_REHEARSAL_NEON_API_KEY);
  const { Client } = await import('pg');
  const client = new Client(config);
  client.on('error', () => {});
  try { await client.connect(); }
  catch { await boundedClient(client,m).finish(); throw new Error('CONNECTION_FAILED'); }
  await installRehearsal(client,m,sql);
  console.log('Disposable rehearsal 0007 committed and ledger verified. No Production approval implied.');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(e => {
    console.error(e?.message?.startsWith('Commit acknowledgement uncertain.') ? e.message : 'Rehearsal stopped. No credentials or provider details printed. If connected, verify rollback and ledger read-only before retry.');
    process.exitCode = 1;
  });
}
