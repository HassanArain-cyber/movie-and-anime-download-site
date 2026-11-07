// Synthetic catalog results ONLY. Not captured from PostgreSQL; no pg import.
import { HASH, WHEN, BASELINE } from '../../scripts/migrations/install-0007.mjs';
import { TABLES, CONSTRAINTS, INDEXES } from '../../scripts/migrations/0007-catalog.mjs';
export const manifest = () => ({environment:'production',approvedMigrationHash:HASH,projectId:'approved-project',branchId:'br-reviewed',endpointId:'ep-reviewed',hostname:'ep-reviewed.us-east-2.aws.neon.tech',database:'vault',role:'vault_owner',ledgerOwner:'vault_owner',originalSearchPath:'"$user", public',serverVersionNum:'180006',approvalReference:'approval-123',identityVerifiedAt:new Date().toISOString(),backupReference:'durable-backup-123',backupSha256:'a'.repeat(64),backupVerifiedAt:new Date().toISOString(),restoreVerificationReference:'isolated-restore-123',port:5432,maintenanceWindowConfirmed:true,applicationSearchPathVerified:true,providerIdentityVerified:true,allowPublicFunctionExecute:true,statementTimeoutMs:60000,networkTimeoutMs:65000,overallTimeoutMs:300000,cleanupTimeoutMs:3000});
export const baseline = () => BASELINE.map(([hash,created_at],i)=>({id:i+1,hash,created_at}));
export const columns = table => TABLES[table].map(c=>({...c,identity:'',generated:''}));
export const constraints = table => CONSTRAINTS[table].map(c=>({...c,valid:true,deferrable:false,deferred:false,local:true,inherited:0,...(c.type==='f'?{deletion:'c',updating:'a',matching:'s'}:{})}));
export const indexes = table => INDEXES[table].map(i=>({...i,valid:true,ready:true,live:true,method:'btree',keycount:i.keys.length,totalcount:i.keys.length,options:i.keys.map(()=>0).join(' '),nullsnotdistinct:false,predicate:null,expressions:null,reloptions:null,default_opclasses:true,default_collations:true}));
export const sequence = (name,owner) => [{name,owner,relkind:'S',relpersistence:'p',int4:true,seqstart:'1',seqincrement:'1',seqmin:'1',seqmax:'2147483647',seqcache:'1',seqcycle:false,dependencies:1,owned_by_id:true,default_depends:true,default_dependents:1,privileges:true}];
export function acl(kind,owner) { return (kind==='table'?['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']:kind==='sequence'?['USAGE','SELECT','UPDATE']:['EXECUTE']).map(privilege=>({grantee:'42',grantor:owner,recipient:owner,privilege,grantable:false})); }
export const defaults = m => ['table','sequence','function'].flatMap(kind=>acl(kind,m.role).concat(kind==='function'?[{grantee:'0',grantor:m.role,recipient:'PUBLIC',privilege:'EXECUTE',grantable:false}]:[]).map(r=>({...r,kind,additive:false})));
const prerequisite = {
 media:{id:['integer',true],type:['character varying(20)',true],title:['character varying(255)',true],slug:['character varying(255)',true]},
 seasons:{id:['integer',true],media_id:['integer',true],season_number:['integer',true]},
 episodes:{id:['integer',true],media_id:['integer',true],season_id:['integer',true],episode_number:['integer',true],title:['character varying(255)',false]},
 download_links:{id:['integer',true],media_id:['integer',false],episode_id:['integer',false],url:['text',true],storage_provider:['character varying(16)',false],object_key:['text',false]},
};
export function fake(sql,m=manifest(), mutate = () => {}) {
 let inserted=false; const calls=[]; let ended=0;
 const statements=new Set(sql.split('--> statement-breakpoint').filter(s=>s.trim()));
 return {calls,get ended(){return ended;}, async end(){ended++;},async query(text,params){
  const label=text.match(/^\/\* 0007:([^ ]+) \*\//)?.[1]||text;
  calls.push({text,params,label});
  let rows=[],command='SELECT';
  if(label==='columns') rows=columns(params[0]);
  else if(label==='constraints') rows=constraints(params[0]);
  else if(label==='indexes') rows=indexes(params[0]);
  else if(label==='relation') rows=[{relkind:'r',relpersistence:'p',relrowsecurity:false,relforcerowsecurity:false,inherits:false,owner:params[0].startsWith('drizzle.')?m.ledgerOwner:m.role}];
  else if(label==='sequence') rows=sequence(params[0],params[0].startsWith('drizzle.')?m.ledgerOwner:m.role);
  else if(label==='sequence-state') rows=[{last_value:'7',is_called:true}];
  else if(label==='resolution') rows=params[0].map(name=>({name,correct:true}));
  else if(label==='default-acl') rows=defaults(m);
  else if(label==='acl') rows=acl(params[0].endsWith('_seq')?'sequence':'table',m.role);
  else if(label==='function-acl') rows=acl('function',m.role).concat(m.allowPublicFunctionExecute?[{grantee:'0',grantor:m.role,recipient:'PUBLIC',privilege:'EXECUTE',grantable:false}]:[]);
  else if(label==='privileges') rows=Array.from({length:11},(_,i)=>({label:String(i),ok:true}));
  else if(label==='function') rows=[{prosrc:sql.match(/AS \$\$([\s\S]*?)\$\$;/)[1],lanname:'plpgsql',owner:m.role,prosecdef:false,proleakproof:false,proisstrict:false,proretset:false,provolatile:'v',proparallel:'u',proconfig:null,prokind:'f',returns_trigger:true}];
  else if(label==='trigger') rows=[{tgtype:21,tgenabled:'O',correct_function:true,tgconstraint:0,tgdeferrable:false,tginitdeferred:false,tgnargs:0,tgoldtable:null,tgnewtable:null,condition:null,columns:['url','episode_id','storage_provider','object_key']}];
  else if(label==='types') rows=[];
  else if(label==='identity') rows=[{database:m.database,role:m.role,session_role:m.role,search_path:m.originalSearchPath,version:m.serverVersionNum,schemas:['pg_catalog','public'],temp_schema:'0'}];
  else if(text.startsWith('SELECT id,hash,created_at')) rows=baseline().concat(inserted?[{id:10,hash:HASH,created_at:WHEN}]:[]);
  else if(text.startsWith('INSERT INTO drizzle.')) {inserted=true;rows=[{id:10}];command='INSERT';}
  else if(statements.has(text)) command='DDL';
  else if(/^(BEGIN|COMMIT|ROLLBACK)$/.test(text)) command=text;
  else if(text.startsWith('SET LOCAL ')||text.startsWith('LOCK TABLE ')||text.startsWith('SELECT set_config(')) rows=[];
  else if(text.startsWith('SELECT c.relname AS table_name')) rows=Object.entries(prerequisite).flatMap(([table_name,cols])=>Object.entries(cols).map(([column_name,[type,required]])=>({table_name,column_name,type,required})));
  else if(text.startsWith('SELECT c.relkind')) rows=[{relkind:'r',relrowsecurity:false,relforcerowsecurity:false,primary_id:true,inherits:false}];
  else if(text.startsWith('SELECT 1 FROM pg_catalog.pg_constraint')) rows=[{}];
  else if(text.startsWith('SELECT oid FROM pg_catalog.pg_event_trigger')||text.startsWith('SELECT r.oid FROM pg_catalog.pg_rewrite')||text.startsWith('SELECT oid FROM pg_catalog.pg_trigger')||text.startsWith('SELECT n.nspname,c.relname')||text.startsWith('SELECT oid FROM pg_catalog.pg_proc')||text.startsWith('SELECT t.oid FROM pg_catalog.pg_trigger')||text.startsWith('SELECT 1 FROM public.episodes')||text.startsWith('SELECT 1 FROM public.download_links')||text.startsWith('SELECT 1 FROM public.episode_publications')) rows=[];
  else throw new Error('UNHANDLED MOCK QUERY: '+text.slice(0,80));
  const result={rows,rowCount:rows.length,command}; await mutate({label,text,params,result,calls,inserted}); return result;
 }};
}
