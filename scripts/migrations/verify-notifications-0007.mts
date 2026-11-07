// FUTURE live TEST harness. Import-safe; never invoked by npm test or build.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { Pool } from 'pg';
import { drainFanout } from '../../src/lib/notifications/fanout.ts';
// @ts-expect-error Import-safe JS modules have no declaration files.
import { scopedFanoutPool } from './0007-scoped-fanout.mjs';
// @ts-expect-error Import-safe JS modules have no declaration files.
import { validateRehearsal, rehearsalConfig, verifyProvider } from './rehearse-0007.mjs';
// @ts-expect-error Import-safe JS modules have no declaration files.
import { artifact, verifyInstalled, HASH, WHEN } from './install-0007.mjs';
async function main(){
  const args=process.argv.slice(2);
  assert.ok(args.length===3&&args[0]==='--verify-isolated-notifications'&&args[1]==='--manifest');
  const m=validateRehearsal(JSON.parse(await readFile(args[2],'utf8')));
  assert.equal(m.projectId,'weathered-fog-95101745');assert.equal(m.branchId,'br-round-scene-b5t9covj');assert.equal(m.endpointId,'ep-morning-poetry-b5eo42g4');
  const config=rehearsalConfig(process.env,m);
  await verifyProvider(m,process.env.VAULT_0007_REHEARSAL_NEON_API_KEY);
  const {Client}=await import('pg');const client=new Client(config);client.on('error',()=>{});
  let browser:import('playwright-core').Browser|undefined;
  let server:ReturnType<typeof createServer>|undefined;
  let transaction=false;let rolledBack=false;
  try{
    await client.connect();await client.query('BEGIN');transaction=true;
    await client.query("SET LOCAL statement_timeout='5s'");await client.query("SET LOCAL transaction_timeout='180s'");await client.query("SET LOCAL idle_in_transaction_session_timeout='60s'");
    const identity=(await client.query("SELECT current_database() AS db,current_user AS role,session_user AS login,current_setting('server_version_num') AS version,current_setting('search_path') AS search_path,current_schemas(true) AS schemas,pg_my_temp_schema()::text AS temp_schema")).rows[0];
    assert.equal(identity.db,m.database);assert.equal(identity.role,m.role);assert.equal(identity.login,m.role);assert.equal(identity.version,'180006');assert.equal(identity.search_path,m.originalSearchPath);assert.equal(identity.schemas[0],'pg_catalog');assert.equal(identity.temp_schema,'0');
    await client.query('SET LOCAL search_path=public');
    assert.equal((await client.query('SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations WHERE hash=$1 AND created_at=$2',[HASH,WHEN])).rows[0].n,1,'Installed 0007 required; harness never migrates');
    await verifyInstalled(client,await artifact(),m);
    const run=randomBytes(16).toString('hex'),subscriber=`0007-test-${run}`,other=`0007-test-${randomBytes(16).toString('hex')}`,title=`0007 isolated ${run}`,slug=`0007-isolated-${run}`;
    const media=(await client.query("INSERT INTO public.media(type,title,slug) VALUES('anime',$1,$2) RETURNING id",[title,slug])).rows[0].id;
    const season=(await client.query('INSERT INTO public.seasons(media_id,season_number) VALUES($1,1) RETURNING id',[media])).rows[0].id;
    const episode=(await client.query("INSERT INTO public.episodes(media_id,season_id,episode_number,title) VALUES($1,$2,1,'Isolated episode') RETURNING id",[media,season])).rows[0].id;
    await client.query('INSERT INTO public.subscribers(id) VALUES($1),($2)',[subscriber,other]);
    const scoped=scopedFanoutPool(client,episode,subscriber) as Pool;
    const processFixture=()=>drainFanout(scoped,Date.now()+10000,2);
    const snapshot=async()=>{
      const notifications=(await client.query('SELECT n.id,n.read_at AS "readAt",n.created_at AS "createdAt",p.media_id AS "mediaId",p.title,p.episode_number AS "episodeNumber",p.episode_title AS "episodeTitle",p.season_number AS "seasonNumber",p.url FROM public.episode_notifications n JOIN public.episode_publications p ON p.episode_id=n.episode_id WHERE n.subscriber_id=$1 AND n.episode_id=$2',[subscriber,episode])).rows;
      const followed=(await client.query('SELECT 1 FROM public.anime_follows WHERE subscriber_id=$1 AND media_id=$2',[subscriber,media])).rowCount;
      return {following:followed?[{id:media,title,type:'anime',slug,posterUrl:null,hasNew:notifications.some(n=>!n.readAt),watchStatus:'plan_to_watch'}]:[],notifications,unread:notifications.filter(n=>!n.readAt).length,hasMore:false};
    };
    const {build}=await import('esbuild');
    const bundle=await build({entryPoints:[fileURLToPath(new URL('./0007-fixture-ui.tsx',import.meta.url))],bundle:true,write:false,jsx:'automatic',platform:'browser',alias:{'next/link':fileURLToPath(new URL('./0007-fixture-link.tsx',import.meta.url))},define:{'process.env.NODE_ENV':'"production"'}});
    const access=randomBytes(32).toString('hex');let requestFailure=false;
    server=createServer(async(req,res)=>{
      try{
        assert.equal(req.headers['x-fixture-access'],access);
        const pathname=new URL(req.url!,'http://fixture.invalid').pathname;
        res.setHeader('Cache-Control','no-store');
        if(req.method==='GET'&&pathname==='/fixture.js'){res.setHeader('Content-Type','application/javascript');res.end(bundle.outputFiles[0].text);return;}
        if(req.method==='GET'&&(pathname==='/'||pathname===`/anime/${slug}`)){
          res.setHeader('Content-Type','text/html');res.end(`<div id="root"></div><script>globalThis.fixture=${JSON.stringify({mediaId:media,episodeId:episode,title})}</script><script src="/fixture.js"></script>`);return;
        }
        res.setHeader('Content-Type','application/json');
        if(req.method==='GET'&&pathname==='/api/updates'){res.end(JSON.stringify(await snapshot()));return;}
        if(req.method==='POST'&&pathname==='/api/follows'){
          let body='';for await(const chunk of req){body+=chunk;assert.ok(body.length<1024);}assert.deepEqual(JSON.parse(body),{mediaId:media});
          await client.query('INSERT INTO public.anime_follows(subscriber_id,media_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[subscriber,media]);res.end('{"followerCount":1}');return;
        }
        if(req.method==='PATCH'&&pathname==='/api/notifications'){
          let body='';for await(const chunk of req){body+=chunk;assert.ok(body.length<1024);}const data=JSON.parse(body);const notes=(await snapshot()).notifications;
          assert.ok(data.all===true||notes.some(n=>n.id===data.id));
          await client.query('UPDATE public.episode_notifications SET read_at=COALESCE(read_at,now()) WHERE subscriber_id=$1 AND episode_id=$2',[subscriber,episode]);res.end('{"success":true}');return;
        }
        throw new Error('Unapproved fixture route');
      }catch{requestFailure=true;res.statusCode=400;res.end('{}');}
    });
    await new Promise<void>(resolve=>server!.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address!=='string');const base=`http://127.0.0.1:${address.port}`;
    const {chromium}=await import('playwright-core');const packaged=(await import('@sparticuz/chromium')).default;
    browser=await chromium.launch({executablePath:await packaged.executablePath(),args:packaged.args,headless:true});
    const context=await browser.newContext({extraHTTPHeaders:{'x-fixture-access':access},serviceWorkers:'block'});
    await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
    const page=await context.newPage();await page.goto(base);await page.getByRole('button',{name:'+ Follow',exact:true}).click();await page.getByRole('button',{name:'Unfollow',exact:true}).waitFor();
    await client.query("INSERT INTO public.download_links(media_id,episode_id,url) VALUES($1,$2,'https://example.invalid/0007-fixture')",[media,episode]);
    await client.query("INSERT INTO public.download_links(media_id,episode_id,url) VALUES($1,$2,'https://example.invalid/0007-fixture-second')",[media,episode]);
    assert.equal((await client.query('SELECT count(*)::int AS n FROM public.episode_publications WHERE episode_id=$1',[episode])).rows[0].n,1);
    assert.equal(await processFixture(),1);assert.equal(await processFixture(),0);
    assert.equal((await client.query('SELECT count(*)::int AS n FROM public.episode_notifications WHERE episode_id=$1 AND subscriber_id<>$2',[episode,subscriber])).rows[0].n,0);
    assert.equal((await client.query('SELECT count(*)::int AS n FROM public.episode_notifications WHERE subscriber_id=$1',[other])).rows[0].n,0);
    await page.reload();await page.getByLabel('Notifications, 1 unread',{exact:true}).waitFor();await page.getByLabel('Notifications, 1 unread',{exact:true}).click();
    await page.getByRole('button',{name:'Mark all read',exact:true}).click();
    await page.getByLabel('Notifications',{exact:true}).waitFor();assert.equal((await snapshot()).unread,0);
    // Fixture-only preparation of another unread state; NOT a claimed app mark-unread feature.
    await client.query('UPDATE public.episode_notifications SET read_at=NULL WHERE subscriber_id=$1 AND episode_id=$2',[subscriber,episode]);
    await page.reload();await page.getByLabel('Notifications, 1 unread',{exact:true}).waitFor();await page.getByLabel('Notifications, 1 unread',{exact:true}).click();
    const link=page.getByRole('region',{name:'Recent notifications'}).getByRole('link').filter({hasText:title});
    assert.equal(await link.getAttribute('href'),`/anime/${slug}#episode-${episode}`);await link.click();await page.waitForURL(`${base}/anime/${slug}#episode-${episode}`);
    await page.getByLabel('Notifications',{exact:true}).waitFor();assert.equal((await snapshot()).unread,0);assert.equal(await page.getByLabel('Unread',{exact:true}).count(),0);
    assert.equal(requestFailure,false);await context.close();
    await client.query('ROLLBACK');transaction=false;rolledBack=true;
    assert.equal((await client.query('SELECT count(*)::int AS n FROM public.media WHERE slug=$1',[slug])).rows[0].n,0);
    assert.equal((await client.query('SELECT count(*)::int AS n FROM public.subscribers WHERE id=ANY($1::text[])',[[subscriber,other]])).rows[0].n,0);
    console.log('PASS: TEST fixture trigger, scoped real fanout, actual UI components and href/read transition; fixture rows rolled back. Next SSR/API routes and mark-unread are NOT tested.');
  }finally{
    try{await browser?.close();}catch{/* cleanup must continue */}
    if(server){server.closeAllConnections();await new Promise<void>(resolve=>server!.close(()=>resolve()));}
    if(transaction){try{await client.query('ROLLBACK');rolledBack=true;}catch{console.error('Fixture rollback unconfirmed; investigate TEST only.');}}
    await client.end();if(!rolledBack)console.error('No confirmed fixture cleanup; do not rerun blindly.');
  }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))void main().catch(()=>{console.error('Isolated verification stopped; no credentials/provider errors printed.');process.exitCode=1;});
