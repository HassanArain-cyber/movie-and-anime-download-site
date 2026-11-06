// Real Drizzle history at 0006, then 0007 and a no-op rerun.
// Requires a verified isolated runner and fresh synthetic DB; never run on Preview/Production.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import pg from 'pg';
import { readFileSync, readlinkSync, statSync } from 'node:fs';
verifyRuntime();
assert.equal(process.env.DATABASE_URL,'postgresql://pr7_test:synthetic-only@127.0.0.1:5433/pr7_staged');
const exec = promisify(execFile);
const pool = new pg.Pool({connectionString:process.env.DATABASE_URL,max:1,connectionTimeoutMillis:5000,query_timeout:30000,statement_timeout:30000});
let scratch;
let primaryError;
try {
scratch = await mkdtemp(path.join(tmpdir(),'pr7-staged-'));
const folder = path.join(scratch,'drizzle');
const journal = JSON.parse(await readFile('drizzle/meta/_journal.json','utf8'));
assert.equal(journal.entries.length,8);
assert.equal(journal.entries[6].tag,'0006_comments');
assert.equal(journal.entries[7].tag,'0007_anime_notifications');
const baseline = JSON.parse(await readFile('tests/fixtures/migrations-0000-0006.json','utf8'));
assert.equal(baseline.commit,'5e7b92abbed48f93c7f0ea00016ec9dcfccf099a');
assert.equal(baseline.entries.length,7);
assert.deepEqual(journal.entries.slice(0,7),baseline.entries.map(({sha256,...entry})=>entry));
for(const entry of baseline.entries) assert.equal(createHash('sha256').update(await readFile(`drizzle/${entry.tag}.sql`)).digest('hex'),entry.sha256);
const cli = path.resolve('node_modules/drizzle-kit/bin.cjs');
const config = path.join(scratch,'config.cjs');
const history = async()=> (await pool.query('SELECT id,hash,created_at FROM drizzle.__drizzle_migrations ORDER BY id')).rows;
const migrate = ()=>exec(process.execPath,[cli,'migrate',`--config=${config}`],{env:process.env});
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='public'")).rows[0].n,0,'Must start with a fresh empty database');
  assert.equal((await pool.query("SELECT to_regclass('drizzle.__drizzle_migrations') AS r")).rows[0].r,null);
  await mkdir(path.join(folder,'meta'),{recursive:true});
  for(const entry of journal.entries.slice(0,7)) await copyFile(`drizzle/${entry.tag}.sql`,path.join(folder,`${entry.tag}.sql`));
  await writeFile(path.join(folder,'meta/_journal.json'),JSON.stringify({...journal,entries:journal.entries.slice(0,7)}));
  await writeFile(config,`module.exports=${JSON.stringify({dialect:'postgresql',schema:path.resolve('src/db/schema.ts'),out:folder,dbCredentials:{url:process.env.DATABASE_URL}})};\n`);
  await migrate(); // Drizzle itself records all seven migrations; no history INSERTs.
  const beforeHistory=await history();
  assert.equal(beforeHistory.length,7);
  for(let i=0;i<7;i++) {
    const sql=await readFile(`drizzle/${journal.entries[i].tag}.sql`,'utf8');
    assert.equal(beforeHistory[i].hash,baseline.entries[i].sha256);
    assert.equal(createHash('sha256').update(sql).digest('hex'),baseline.entries[i].sha256);
    assert.equal(String(beforeHistory[i].created_at),String(journal.entries[i].when));
  }
  for(const table of ['subscribers','anime_follows','episode_publications','episode_notifications']) {
    assert.equal((await pool.query('SELECT to_regclass($1) AS r',[`public.${table}`])).rows[0].r,null,`${table} must be absent before 0007`);
  }
  await exec(process.execPath,['tests/seed-legacy.mjs'],{env:process.env});
  const anime=(await pool.query("SELECT id FROM media WHERE slug='legacy-anime'")).rows[0];
  const season=(await pool.query('SELECT id FROM seasons WHERE media_id=$1',[anime.id])).rows[0];
  const published=(await pool.query('SELECT id FROM episodes WHERE season_id=$1',[season.id])).rows[0];
  const placeholder=(await pool.query("INSERT INTO episodes(media_id,season_id,episode_number,title) VALUES($1,$2,2,'Placeholder') RETURNING id",[anime.id,season.id])).rows[0];
  const tables=(await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name")).rows.map(r=>r.table_name);
  const snapshot=async()=>{
    const result={};
    for(const table of tables) result[table]=(await pool.query(`SELECT to_jsonb(t) AS row FROM "${table.replaceAll('"','""')}" t ORDER BY to_jsonb(t)::text`)).rows;
    return result;
  };
  const before=await snapshot();
  await copyFile('drizzle/0007_anime_notifications.sql',path.join(folder,'0007_anime_notifications.sql'));
  await writeFile(path.join(folder,'meta/_journal.json'),JSON.stringify(journal));
  await migrate();
  const upgraded=await history();
  assert.equal(upgraded.length,8);
  assert.deepEqual(upgraded.slice(0,7),beforeHistory);
  assert.equal(upgraded[7].hash,createHash('sha256').update(await readFile('drizzle/0007_anime_notifications.sql','utf8')).digest('hex'));
  assert.equal(String(upgraded[7].created_at),String(journal.entries[7].when));
  assert.deepEqual(await snapshot(),before,'Every pre-0007 public table row must remain unchanged');
  const legacy=(await pool.query('SELECT * FROM episode_publications WHERE episode_id=$1',[published.id])).rows;
  assert.equal(legacy.length,1); assert.ok(legacy[0].processed_at);
  assert.equal((await pool.query('SELECT * FROM episode_publications WHERE episode_id=$1',[placeholder.id])).rowCount,0);
  assert.equal((await pool.query('SELECT * FROM episode_notifications')).rowCount,0);
  const subscriber='8'.repeat(64);
  await pool.query('INSERT INTO subscribers(id) VALUES($1)',[subscriber]);
  await pool.query('INSERT INTO anime_follows(subscriber_id,media_id) VALUES($1,$2)',[subscriber,anime.id]);
  assert.equal((await pool.query('SELECT watch_status FROM anime_follows WHERE subscriber_id=$1',[subscriber])).rows[0].watch_status,'plan_to_watch');
  for(const status of ['plan_to_watch','watching','continue','on_hold','watched']) await pool.query('UPDATE anime_follows SET watch_status=$1 WHERE subscriber_id=$2',[status,subscriber]);
  await assert.rejects(pool.query("UPDATE anime_follows SET watch_status='invalid' WHERE subscriber_id=$1",[subscriber]),{code:'23514'});
  await assert.rejects(pool.query('UPDATE anime_follows SET watch_status=NULL WHERE subscriber_id=$1',[subscriber]),{code:'23502'});
  await pool.query("INSERT INTO download_links(media_id,episode_id,label,url) VALUES($1,$2,'720p','/uploads/videos/legacy.mp4')",[anime.id,placeholder.id]);
  await pool.query("INSERT INTO download_links(media_id,episode_id,label,url) VALUES($1,$2,'1080p','/uploads/videos/legacy.mp4')",[anime.id,placeholder.id]);
  const publications=(await pool.query('SELECT * FROM episode_publications ORDER BY episode_id')).rows;
  assert.equal(publications.filter(p=>p.episode_id===placeholder.id).length,1,'First usable link publishes once across qualities');
  const relevantBeforeRerun=await completeState(pool);
  await migrate();
  assert.deepEqual(await completeState(pool),relevantBeforeRerun,'Rerun must preserve all relevant rows, sequences and schema definitions');
  assert.deepEqual(await history(),upgraded,'Rerun must not append/rewrite migration history');
  assert.deepEqual((await pool.query('SELECT * FROM episode_publications ORDER BY episode_id')).rows,publications,'Rerun must not recreate events or timestamps');
  assert.equal((await pool.query('SELECT * FROM episode_notifications')).rowCount,0,'Migration rerun must not deliver retroactive notifications');
  for(const table of ['push_subscriptions','push_deliveries']) assert.equal((await pool.query('SELECT to_regclass($1) AS r',[`public.${table}`])).rows[0].r,null);
  console.log('PASS: genuine 0000–0006 Drizzle history, 0007-only upgrade, legacy preservation, backfill, five statuses, first-link deduplication and migration rerun');
} catch(error) { primaryError=error; } finally {
  await cleanup([()=>pool.end(),()=>scratch?rm(scratch,{recursive:true,force:true}):undefined],primaryError);
}

async function completeState(pool) {
  const state={rows:{},sequences:{}};
  const quote=name=>'"'+name.replaceAll('"','""')+'"';
  const relations=(await pool.query("SELECT n.nspname AS schema,c.relname AS name,c.relkind AS kind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','drizzle') AND c.relkind IN ('r','p','S','v','m') ORDER BY 1,2")).rows;
  state.relations=relations;
  for(const {schema,name,kind} of relations) {
    const qualified=quote(schema)+'.'+quote(name);
    if(kind==='S') state.sequences[qualified]=(await pool.query(`SELECT last_value,is_called FROM ${qualified}`)).rows;
    else if(['r','p','m'].includes(kind)) state.rows[qualified]=(await pool.query(`SELECT to_jsonb(t) AS row FROM ${qualified} t ORDER BY to_jsonb(t)::text`)).rows;
  }
  const queries={
    ownership:"SELECT n.nspname,c.relname,c.relkind,c.relowner,c.relacl,c.relrowsecurity,c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','drizzle') ORDER BY 1,2,3",
    policies:"SELECT * FROM pg_policies WHERE schemaname IN ('public','drizzle') ORDER BY schemaname,tablename,policyname",
    grants:"SELECT * FROM information_schema.role_table_grants WHERE table_schema IN ('public','drizzle') ORDER BY table_schema,table_name,grantee,privilege_type",
    enums:"SELECT n.nspname,t.typname,e.enumlabel,e.enumsortorder FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace JOIN pg_enum e ON e.enumtypid=t.oid WHERE n.nspname IN ('public','drizzle') ORDER BY 1,2,4",
    columns:"SELECT * FROM information_schema.columns WHERE table_schema IN ('public','drizzle') ORDER BY table_schema,table_name,ordinal_position",
    constraints:"SELECT n.nspname,c.relname,p.conname,pg_get_constraintdef(p.oid) AS definition FROM pg_constraint p JOIN pg_class c ON c.oid=p.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','drizzle') ORDER BY 1,2,3",
    indexes:"SELECT * FROM pg_indexes WHERE schemaname IN ('public','drizzle') ORDER BY schemaname,tablename,indexname",
    triggers:"SELECT n.nspname,c.relname,t.tgname,pg_get_triggerdef(t.oid) AS definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','drizzle') AND NOT t.tgisinternal ORDER BY 1,2,3",
    functions:"SELECT n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) AS arguments,pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','drizzle') AND p.prokind IN ('f','p') ORDER BY 1,2,3",
    views:"SELECT * FROM pg_views WHERE schemaname IN ('public','drizzle') ORDER BY schemaname,viewname"
  };
  for(const [name,sql] of Object.entries(queries)) state[name]=(await pool.query(sql)).rows;
  return state;
}

// Kept self-contained so this regression needs no disposable jail tooling.
function verifyRuntime() {
  const proof = JSON.parse(readFileSync('/run/pr7-attestation.json','utf8'));
  for (const name of ['user','net','mnt','pid']) {
    assert.notEqual(proof.parent[name],proof.current[name],`No ${name} transition`);
    assert.equal(readlinkSync(`/proc/self/ns/${name}`),proof.current[name]);
  }
  assert.notEqual(process.getuid(),0);
  const status=readFileSync('/proc/self/status','utf8');
  for(const name of ['CapEff','CapPrm','CapBnd','CapAmb']) assert.match(status,new RegExp(name+':\\s+0+\\n'));
  assert.match(status,/NoNewPrivs:\s+1\n/);
  const root=statSync('/'), initRoot=statSync('/proc/1/root');
  assert.equal(root.dev,initRoot.dev); assert.equal(root.ino,initRoot.ino);
  const interfaces=readFileSync('/proc/net/dev','utf8').split('\n').slice(2).filter(x=>x.includes(':')).map(x=>x.split(':')[0].trim());
  assert.deepEqual(interfaces,['lo']);
}

// Attempt every cleanup, preserve the original failure, and bound each operation.
async function cleanup(actions, primaryError, timeout=5000) {
  const errors=primaryError?[primaryError]:[];
  for(const action of actions) {
    let timer;
    try {
      await Promise.race([Promise.resolve().then(action),new Promise((_,reject)=>{
        timer=setTimeout(()=>reject(new Error('Cleanup timed out')),timeout);
      })]);
    } catch(error) { errors.push(error); }
    finally { clearTimeout(timer); }
  }
  if(errors.length) throw new AggregateError(errors,'Execution/setup/cleanup failed');
}
