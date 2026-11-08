import { installValidated } from './0007-engine.mjs';
/** One-shot, approval-gated 0007 installer. Never imports app code or dotenv. */
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { boundedClient } from './0007-deadline.mjs';
import { insist, SOURCE_TABLES, FEATURE_TABLES, FUNCTION_RELATIONS, RELATION_SQL, RESOLUTION_SQL, checkResolution, verifyTable, verifySequence, verifyPrivileges, verifyDefaults, ACL_SQL, FUNCTION_ACL_SQL, checkAcl } from './0007-catalog.mjs';

export const HASH = 'd6c108d47c5c45a4ff16b17ea5e07ca45f2c71b7d1e1a851a5d7143fb3c14666';
export const WHEN = '1793806633286';
export const BASELINE = [
  ['a6df4f96dd9c941b4d05b098fe3e6f43e1f7029a3f04cd7b3a4c506b623d45ae', '1793511643169'],
  ['f02d1b855b98f4078d96ffd80a4c98c656a1052d78bed8bcb9c81474ada890cb', '1793512872497'],
  ['3b8a1a341efd789384dfb1e12838ae0abd5bba17761a3804b823c6e768ec4710', '1793522364964'],
  ['5d6fc9fad489c385dc8ce379c7dcd13b9da81b7d2fd030836f2119fe0114c43b', '1793529555040'],
  ['f7431445d99a3ec4c4fb2dee24c7c55f51b98e38c227a4343cc721259da6d4db', '1793595062622'],
  ['494e85d7d5de19757d6596db2ec55d6e8d8ef6007af538be270031376ae55a6f', '1793616734911'],
  ['bc29fc4bd38759e55cd85e968c5ef39cacc955d1a3b581373ae590a2f9c1e252', '1793711657492'],
];
const root = fileURLToPath(new URL('../../', import.meta.url));
function requireThat(ok, reason) { if (!ok) throw new Error(reason); }
export async function artifact() {
  const bytes = await readFile(path.join(root, 'drizzle/0007_anime_notifications.sql'));
  requireThat(createHash('sha256').update(bytes).digest('hex') === HASH, 'artifact hash mismatch');
  const journal = JSON.parse(await readFile(path.join(root, 'drizzle/meta/_journal.json'), 'utf8'));
  const entries = journal.entries.filter((e) => e.idx === 7 || e.tag === '0007_anime_notifications');
  requireThat(entries.length === 1 && entries[0].idx === 7 && entries[0].tag === '0007_anime_notifications' && String(entries[0].when) === WHEN && entries[0].version === '7' && entries[0].breakpoints === true, 'journal mismatch');
  // No reformatting, interpolation, or rewriting of the original SQL.
  return bytes.toString('utf8');
}
export function validateManifest(m) {
  requireThat(m.environment === 'production' && m.approvedMigrationHash === HASH, 'approval mismatch');
  for (const key of ['projectId', 'branchId', 'endpointId', 'hostname', 'database', 'role', 'originalSearchPath', 'serverVersionNum', 'approvalReference', 'identityVerifiedAt', 'backupReference', 'backupSha256', 'backupVerifiedAt', 'restoreVerificationReference', 'ledgerOwner']) {
    requireThat(typeof m[key] === 'string' && m[key].trim().length > 0 && !/[\r\n]/.test(m[key]) && !/REPLACE|EXAMPLE|TODO/i.test(m[key]), 'incomplete approval manifest');
  }
  requireThat(/^br-[a-z0-9-]+$/.test(m.branchId) && /^ep-[a-z0-9-]+$/.test(m.endpointId), 'invalid Neon identifiers');
  requireThat(m.hostname.startsWith(`${m.endpointId}.`) && /^[a-z0-9.-]+\.neon\.tech$/.test(m.hostname) && !m.hostname.includes('-pooler.'), 'direct Neon endpoint required');
  requireThat(/^\d+$/.test(m.serverVersionNum) && /^[a-f0-9]{64}$/.test(m.backupSha256), 'invalid verification evidence');
  for (const field of ['identityVerifiedAt', 'backupVerifiedAt']) {
    const age = Date.now() - Date.parse(m[field]);
    requireThat(Number.isFinite(age) && age >= 0 && age <= 24 * 3600 * 1000, 'verification evidence older than 24 hours');
  }
  requireThat(m.port === 5432 && m.maintenanceWindowConfirmed === true && m.applicationSearchPathVerified === true && m.providerIdentityVerified === true, 'missing operator attestations');
  requireThat(typeof m.allowPublicFunctionExecute === 'boolean', 'PUBLIC function ACL decision required');
  const version = Number(m.serverVersionNum);
  requireThat(version >= 170000 && version < 190000, 'only reviewed PostgreSQL 17/18 catalogs supported');
  requireThat(Number.isInteger(m.overallTimeoutMs) && m.overallTimeoutMs >= 1000 && m.overallTimeoutMs <= 600000, 'invalid overall deadline');
  requireThat(Number.isInteger(m.networkTimeoutMs) && m.networkTimeoutMs >= 1000 && m.networkTimeoutMs <= m.overallTimeoutMs, 'invalid network deadline');
  requireThat(Number.isInteger(m.cleanupTimeoutMs) && m.cleanupTimeoutMs >= 1000 && m.cleanupTimeoutMs <= 10000, 'invalid cleanup deadline');
  requireThat(m.statementTimeoutMs < m.networkTimeoutMs && m.statementTimeoutMs <= m.overallTimeoutMs, 'server timeout must precede client timeout');
  requireThat(m.statementTimeoutMs >= 1000 && m.statementTimeoutMs <= 1800000 && Number.isInteger(m.statementTimeoutMs), 'invalid timeout');
  return m;
}
export function connectionConfig(raw, manifest) {
  const u = new URL(raw);
  requireThat(['postgres:', 'postgresql:'].includes(u.protocol), 'PostgreSQL URL required');
  // Reject overrides, multi-host URLs, alternate credentials and hidden search_path.
  for (const key of u.searchParams.keys()) requireThat(key === 'sslmode' || key === 'channel_binding', 'unsupported connection option');
  requireThat(u.hostname === manifest.hostname && Number(u.port || 5432) === manifest.port && decodeURIComponent(u.pathname.slice(1)) === manifest.database && decodeURIComponent(u.username) === manifest.role && u.password.length > 0 && !u.hash, 'connection identity mismatch');
  return { host: manifest.hostname, port: manifest.port, database: manifest.database, user: manifest.role, password: decodeURIComponent(u.password), ssl: { rejectUnauthorized: true, servername: manifest.hostname }, connectionTimeoutMillis: 10000, application_name: 'vault-reviewed-0007-installer', keepAlive: true, keepAliveInitialDelayMillis: 1000, options: `-c statement_timeout=${manifest.statementTimeoutMs} -c lock_timeout=5000 -c idle_in_transaction_session_timeout=10000 -c transaction_timeout=${manifest.overallTimeoutMs}` };
}
export function checkLedger(rows, installed = false) {
  requireThat(rows.length === BASELINE.length + Number(installed), 'unexpected ledger length');
  BASELINE.forEach(([hash, when], i) => requireThat(Number(rows[i].id) === i + 1 && rows[i].hash === hash && String(rows[i].created_at) === when, 'baseline ledger mismatch'));
  if (installed) requireThat(rows[7].hash === HASH && String(rows[7].created_at) === WHEN && Number(rows[7].id) > 7, 'new ledger mismatch');
}
const prerequisiteColumns = {
  media: { id: ['integer', true], type: ['character varying(20)', true], title: ['character varying(255)', true], slug: ['character varying(255)', true] },
  seasons: { id: ['integer', true], media_id: ['integer', true], season_number: ['integer', true] },
  episodes: { id: ['integer', true], media_id: ['integer', true], season_id: ['integer', true], episode_number: ['integer', true], title: ['character varying(255)', false] },
  download_links: { id: ['integer', true], media_id: ['integer', false], episode_id: ['integer', false], url: ['text', true], storage_provider: ['character varying(16)', false], object_key: ['text', false] },
};
const columnsSql = `SELECT c.relname AS table_name,a.attname AS column_name,format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull AS required
 FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid=a.attrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relname=ANY($1::text[]) AND a.attnum>0 AND NOT a.attisdropped`;
const ledgerSql = 'SELECT id,hash,created_at FROM drizzle.__drizzle_migrations ORDER BY id';
const tableNames = FEATURE_TABLES;
export async function preflight(client) {
  requireThat((await client.query("SELECT oid FROM pg_catalog.pg_event_trigger WHERE evtenabled<>'D'")).rowCount === 0, 'DDL event triggers require review');
  requireThat((await client.query(`SELECT r.oid FROM pg_catalog.pg_rewrite r WHERE r.ev_class=ANY(ARRAY['public.media'::regclass,'public.seasons'::regclass,'public.episodes'::regclass,'public.download_links'::regclass,'drizzle.__drizzle_migrations'::regclass])`)).rowCount === 0, 'existing rules require review');
  requireThat((await client.query("SELECT oid FROM pg_catalog.pg_trigger WHERE tgrelid='drizzle.__drizzle_migrations'::regclass AND NOT tgisinternal")).rowCount === 0, 'ledger triggers require review');

  for (const [table, column, target] of [['episodes','media_id','media'],['episodes','season_id','seasons'],['seasons','media_id','media'],['download_links','episode_id','episodes'],['download_links','media_id','media']]) {
    const fk = await client.query(`SELECT 1 FROM pg_catalog.pg_constraint k
      JOIN pg_catalog.pg_attribute a ON a.attrelid=k.conrelid AND a.attname=$2
      JOIN pg_catalog.pg_attribute b ON b.attrelid=k.confrelid AND b.attname='id'
      WHERE k.conrelid=to_regclass($1) AND k.confrelid=to_regclass($3) AND k.contype='f' AND k.convalidated
      AND k.conkey=ARRAY[a.attnum]::smallint[] AND k.confkey=ARRAY[b.attnum]::smallint[] AND k.confdeltype='c' AND k.confupdtype='a'`, [`public.${table}`,column,`public.${target}`]);
    requireThat(fk.rowCount === 1, 'prerequisite foreign key mismatch');
  }
  const objects = await client.query(`SELECT n.nspname,c.relname FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname !~ '^pg_toast' AND
    (c.relname ~ '^(subscribers|anime_follows|episode_publications|episode_notifications|push_subscriptions|push_deliveries)(_|$)')`);
  requireThat(objects.rowCount === 0, 'partial feature relations exist');
  const types = await client.query(`/* 0007:types */ SELECT n.nspname,t.typname FROM pg_catalog.pg_type t JOIN pg_catalog.pg_namespace n ON n.oid=t.typnamespace
    WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname !~ '^pg_toast' AND t.typname ~ '^_?(subscribers|anime_follows|episode_publications|episode_notifications|push_subscriptions|push_deliveries)(_|$)'`);
  requireThat(types.rowCount === 0, 'conflicting feature types exist');
  const functions = await client.query("SELECT oid FROM pg_catalog.pg_proc WHERE proname='vault_record_episode_publication'");
  const triggers = await client.query("SELECT oid FROM pg_catalog.pg_trigger WHERE tgname='vault_episode_first_link' AND NOT tgisinternal");
  requireThat(functions.rowCount === 0 && triggers.rowCount === 0, 'partial function or trigger exists');
  const found = (await client.query(columnsSql, [Object.keys(prerequisiteColumns)])).rows;
  for (const [table, cols] of Object.entries(prerequisiteColumns)) for (const [name, [type, required]] of Object.entries(cols)) {
    requireThat(found.some((r) => r.table_name === table && r.column_name === name && r.type === type && r.required === required), 'prerequisite column mismatch');
  }
  for (const table of Object.keys(prerequisiteColumns)) {
    const result = await client.query(`SELECT c.relkind,c.relrowsecurity,c.relforcerowsecurity,
      EXISTS(SELECT 1 FROM pg_catalog.pg_inherits WHERE inhrelid=c.oid OR inhparent=c.oid) AS inherits,
      EXISTS(SELECT 1 FROM pg_catalog.pg_constraint k JOIN pg_catalog.pg_attribute a ON a.attrelid=k.conrelid AND a.attname='id'
      WHERE k.conrelid=c.oid AND k.contype='p' AND k.convalidated AND k.conkey=ARRAY[a.attnum]::smallint[]) AS primary_id
      FROM pg_catalog.pg_class c WHERE c.oid=to_regclass($1)`, [`public.${table}`]);
    requireThat(result.rows.length === 1 && result.rows[0].relkind === 'r' && result.rows[0].primary_id && !result.rows[0].inherits && !result.rows[0].relrowsecurity && !result.rows[0].relforcerowsecurity, 'prerequisite relation mismatch or RLS');
  }
  // Reject unexpected user triggers, including differently named publication hooks.
  requireThat((await client.query(`SELECT t.oid FROM pg_catalog.pg_trigger t WHERE t.tgrelid=ANY(ARRAY['public.media'::regclass,'public.seasons'::regclass,'public.episodes'::regclass,'public.download_links'::regclass]) AND NOT t.tgisinternal`)).rowCount === 0, 'existing user triggers require separate review');
  requireThat((await client.query(`SELECT 1 FROM public.episodes e LEFT JOIN public.media m ON m.id=e.media_id LEFT JOIN public.seasons s ON s.id=e.season_id
    WHERE m.id IS NULL OR s.id IS NULL OR s.media_id IS DISTINCT FROM e.media_id LIMIT 1`)).rowCount === 0, 'incompatible episode relationships');
  requireThat((await client.query(`SELECT 1 FROM public.download_links d LEFT JOIN public.episodes e ON e.id=d.episode_id LEFT JOIN public.media m ON m.id=d.media_id
    WHERE (d.episode_id IS NOT NULL AND e.id IS NULL) OR (d.media_id IS NOT NULL AND m.id IS NULL) LIMIT 1`)).rowCount === 0, 'orphan links');
}
export async function verifyInstalled(client, sql, manifest) {
  for (const table of tableNames) {
    await verifyTable(client, `public.${table}`, manifest.role);
    checkAcl((await client.query(ACL_SQL,[`public.${table}`])).rows, manifest.role, 'table', false);
  }
  await verifySequence(client,'public.episode_notifications_id_seq','public.episode_notifications',manifest.role);
  checkAcl((await client.query(ACL_SQL,['public.episode_notifications_id_seq'])).rows,manifest.role,'sequence',false);
  const functions = await client.query(`/* 0007:function */ SELECT p.prosrc,l.lanname,pg_get_userbyid(p.proowner) AS owner,p.prosecdef,p.proleakproof,p.proisstrict,p.proretset,p.provolatile,p.proparallel,p.proconfig,p.prokind,p.prorettype='pg_catalog.trigger'::regtype AS returns_trigger
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid=p.prolang WHERE p.oid=to_regprocedure('public.vault_record_episode_publication()')`);
  const body = sql.match(/AS \$\$([\s\S]*?)\$\$;/)?.[1];
  const f=functions.rows[0];
  requireThat(functions.rowCount===1 && f.prosrc===body && f.lanname==='plpgsql' && f.owner===manifest.role && !f.prosecdef && !f.proleakproof && !f.proisstrict && !f.proretset && f.provolatile==='v' && f.proparallel==='u' && !f.proconfig && f.prokind==='f' && f.returns_trigger, 'function definition/owner mismatch');
  checkAcl((await client.query(FUNCTION_ACL_SQL)).rows,manifest.role,'function',manifest.allowPublicFunctionExecute);
  const triggers = await client.query(`/* 0007:trigger */ SELECT t.tgtype,t.tgenabled,t.tgfoid=to_regprocedure('public.vault_record_episode_publication()') AS correct_function,
    t.tgconstraint,t.tgdeferrable,t.tginitdeferred,t.tgnargs,t.tgoldtable,t.tgnewtable,pg_get_expr(t.tgqual,t.tgrelid) AS condition,
    ARRAY(SELECT a.attname FROM unnest(t.tgattr::smallint[]) WITH ORDINALITY x(num,ord) JOIN pg_catalog.pg_attribute a ON a.attrelid=t.tgrelid AND a.attnum=x.num ORDER BY x.ord) AS columns
    FROM pg_catalog.pg_trigger t WHERE t.tgrelid='public.download_links'::regclass AND t.tgname='vault_episode_first_link' AND NOT t.tgisinternal`);
  const t=triggers.rows[0];
  requireThat(triggers.rowCount===1 && Number(t.tgtype)===21 && t.tgenabled==='O' && t.correct_function && Number(t.tgconstraint)===0 && !t.tgdeferrable && !t.tginitdeferred && t.tgnargs===0 && !t.tgoldtable && !t.tgnewtable && !t.condition && JSON.stringify(t.columns)===JSON.stringify(['url','episode_id','storage_provider','object_key']), 'trigger definition/UPDATE OF mismatch');
  requireThat((await client.query('SELECT 1 FROM public.episode_publications WHERE processed_at IS NULL LIMIT 1')).rowCount === 0, 'legacy publication not processed');
  requireThat((await client.query(`SELECT 1 FROM public.episodes e JOIN public.media m ON m.id=e.media_id JOIN public.seasons s ON s.id=e.season_id
    WHERE m.type IN ('anime','series') AND EXISTS(SELECT 1 FROM public.download_links d WHERE d.episode_id=e.id AND
    (d.url ~* '^(https?://[^/[:space:]]+|tg:|magnet:)' OR d.url LIKE '/uploads/%' OR (d.storage_provider='r2' AND d.object_key IS NOT NULL AND length(d.object_key)>0)))
    AND NOT EXISTS(SELECT 1 FROM public.episode_publications p WHERE p.episode_id=e.id) LIMIT 1`)).rowCount === 0, 'backfill coverage failed');
  // Restore the actual login search_path and verify all application names, including
  // the new function relation, before returning to the pinned installation path.
  await client.query("SELECT set_config('search_path',$1,true)",[manifest.originalSearchPath]);
  const names=[...new Set([...FUNCTION_RELATIONS,...SOURCE_TABLES,...FEATURE_TABLES])];
  checkResolution((await client.query(RESOLUTION_SQL,[names])).rows,names);
  await client.query('SET LOCAL search_path = public');
}
export async function install(rawClient, manifest, sql) {
  validateManifest(manifest);
  return installValidated(rawClient, manifest, sql);
}
export async function main(args = process.argv.slice(2)) {
  requireThat(args.length === 3 && args[0] === '--apply-approved-0007' && args[1] === '--manifest', 'Usage: node scripts/migrations/install-0007.mjs --apply-approved-0007 --manifest /secure/approved.json');
  const sql = await artifact();
  const manifest = validateManifest(JSON.parse(await readFile(args[2], 'utf8')));
  const config = connectionConfig(process.env.VAULT_0007_DATABASE_URL || '', manifest);
  const { Client } = await import('pg');
  const client = new Client(config);
  // Attach a handler so an idle socket error cannot dump a provider error object.
  client.on('error', () => {});
  try { await client.connect(); }
  catch { const cleanup=boundedClient(client,manifest); await cleanup.finish(); throw new Error('CONNECTION_FAILED'); }
  await install(client, manifest, sql);
  console.log('0007 transaction committed and ledger verified. No other migration was run.');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    // Whitelist only our ambiguous-commit advisory. All other errors are generic.
    console.error(e?.message?.startsWith('Commit acknowledgement uncertain.') ? e.message : 'Installer stopped. No credentials or provider error details printed. If a connection was established, verify transaction/ledger state read-only before any retry.');
    process.exitCode = 1;
  });
}
