// Shared transaction engine. Callers must validate their own approval gate first.
import { createHash } from 'node:crypto';
import { boundedClient } from './0007-deadline.mjs';
import { insist, SOURCE_TABLES, RESOLUTION_SQL, checkResolution, verifyTable, verifySequence, verifyPrivileges, verifyDefaults, FUNCTION_ACL_SQL, checkAcl } from './0007-catalog.mjs';
import { HASH, WHEN, checkLedger, preflight, verifyInstalled } from './install-0007.mjs';
function requireThat(ok, reason) { if (!ok) throw new Error(reason); }
const ledgerSql = 'SELECT id,hash,created_at FROM drizzle.__drizzle_migrations ORDER BY id';
export async function installValidated(rawClient, manifest, sql) {
  requireThat(createHash('sha256').update(sql).digest('hex') === HASH, 'SQL hash mismatch');
  const restrictFunctionAcl = manifest.environment === 'rehearsal';
  if (restrictFunctionAcl) {
    requireThat(manifest.allowPublicFunctionExecute === false && manifest.role === 'neondb_owner', 'owner-only rehearsal policy required');
  }
  // Only the known owner/PUBLIC EXECUTE defaults may be inherited for functions.
  // The final object must be owner-only. Table/sequence checks remain identical.
  const creationDefaults = restrictFunctionAcl ? { ...manifest, allowPublicFunctionExecute: true } : manifest;
  const client = boundedClient(rawClient, manifest);
  let transaction = false;
  let commitAttempted = false;
  try {
    await client.query('BEGIN'); transaction = true;
    // Startup settings already bound the identity query when using the CLI.
    const identity = (await client.query(`/* 0007:identity */ SELECT pg_catalog.current_database() AS database,current_user AS role,session_user AS session_role,pg_catalog.current_setting('search_path') AS search_path,pg_catalog.current_setting('server_version_num') AS version,pg_catalog.current_schemas(true) AS schemas,pg_catalog.pg_my_temp_schema()::text AS temp_schema`)).rows[0];
    requireThat(identity.database === manifest.database && identity.role === manifest.role && identity.session_role === manifest.role && identity.search_path === manifest.originalSearchPath && identity.version === manifest.serverVersionNum && identity.schemas?.[0] === 'pg_catalog' && identity.temp_schema === '0', 'server identity or unsafe login path mismatch');
    checkResolution((await client.query(RESOLUTION_SQL,[SOURCE_TABLES])).rows,SOURCE_TABLES);
    await client.query('SET LOCAL search_path = public');
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout = '10s'");
    await client.query("SET LOCAL synchronous_commit = on");
    await client.query("SELECT set_config('transaction_timeout',$1,true)",[String(Math.max(1,client.remaining()))]);
    await client.query("SELECT set_config('statement_timeout',$1,true)", [String(manifest.statementTimeoutMs)]);
    await verifyPrivileges(client);
    // Inspect the real ledger before reading it or invoking its ID default.
    await verifyTable(client,'drizzle.__drizzle_migrations',manifest.ledgerOwner);
    await verifySequence(client,'drizzle.__drizzle_migrations_id_seq','drizzle.__drizzle_migrations',manifest.ledgerOwner,true);
    // One fixed order: ledger -> media -> seasons -> episodes -> download_links.
    // No concurrent migration operator is permitted by the approval manifest.
    await client.query('LOCK TABLE drizzle.__drizzle_migrations IN EXCLUSIVE MODE');
    await verifyTable(client,'drizzle.__drizzle_migrations',manifest.ledgerOwner);
    await verifySequence(client,'drizzle.__drizzle_migrations_id_seq','drizzle.__drizzle_migrations',manifest.ledgerOwner,true);
    checkLedger((await client.query(ledgerSql)).rows);
    await client.query('LOCK TABLE public.media,public.seasons,public.episodes,public.download_links IN SHARE ROW EXCLUSIVE MODE');
    await preflight(client);
    await verifyDefaults(client,creationDefaults);
    let functionRestricted = false;
    for (const statement of sql.split('--> statement-breakpoint')) {
      if (!statement.trim()) continue;
      if (restrictFunctionAcl && statement.includes('CREATE TRIGGER vault_episode_first_link')) {
        requireThat(functionRestricted, 'function ACL must be verified before trigger creation');
      }
      await client.query(statement);
      if (restrictFunctionAcl && statement.includes('CREATE FUNCTION vault_record_episode_publication()')) {
        // Fixed identifiers only; no SQL interpolation, no default-privilege changes.
        // Owner EXECUTE is preserved, not re-granted to conceal a divergent ACL.
        await client.query('REVOKE EXECUTE ON FUNCTION public.vault_record_episode_publication() FROM PUBLIC');
        checkAcl((await client.query(FUNCTION_ACL_SQL)).rows, manifest.role, 'function', false);
        functionRestricted = true;
      }
    }
    if (restrictFunctionAcl) requireThat(functionRestricted, 'function ACL restriction missing');
    await verifyInstalled(client, sql, manifest);
    await verifyDefaults(client,creationDefaults);
    checkLedger((await client.query(ledgerSql)).rows);
    const recorded = await client.query('INSERT INTO drizzle.__drizzle_migrations (hash,created_at) VALUES ($1,$2) RETURNING id', [HASH, WHEN]);
    requireThat(recorded.rowCount === 1, 'ledger insert failed');
    checkLedger((await client.query(ledgerSql)).rows, true);
    commitAttempted = true;
    const result = await client.query('COMMIT');
    insist(result.command==='COMMIT','commit not acknowledged');
    transaction = false; client.markCommitted();
  } catch {
    if (transaction) { try { await client.rollback(); } catch { /* transport gone; never expose provider error */ } }
    throw new Error(commitAttempted ? 'Commit acknowledgement uncertain. Do not rerun: inspect ledger and objects read-only.' : 'Installation aborted. Confirm rollback and ledger read-only before any retry.');
  } finally { await client.finish(); }
}
