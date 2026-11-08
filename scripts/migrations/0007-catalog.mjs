/** Read-only catalog contracts for the pinned 0007 installer. No pg import. */
export function insist(ok, code) { if (!ok) throw new Error(code); }
export const FEATURE_TABLES = ['subscribers', 'anime_follows', 'episode_publications', 'episode_notifications'];
export const SOURCE_TABLES = ['media', 'seasons', 'episodes', 'download_links'];
export const FUNCTION_RELATIONS = ['episode_publications', 'episodes', 'media', 'seasons'];
const col = (name, type, required = true, def = null) => ({ name, type, required, def });
export const TABLES = {
  'drizzle.__drizzle_migrations': [col('id','integer',true,"nextval('drizzle.__drizzle_migrations_id_seq'::regclass)"),col('hash','text'),col('created_at','bigint',false)],
  'public.subscribers': [col('id','character varying(64)'),col('created_at','timestamp with time zone',true,'now()')],
  'public.anime_follows': [col('watch_status','text',true,"'plan_to_watch'::text"),col('subscriber_id','character varying(64)'),col('media_id','integer'),col('created_at','timestamp with time zone',true,'now()')],
  'public.episode_publications': [col('episode_id','integer'),col('media_id','integer'),col('title','character varying(255)'),col('episode_number','integer'),col('episode_title','character varying(255)',false),col('season_number','integer'),col('url','text'),col('published_at','timestamp with time zone',true,'now()'),col('processed_at','timestamp with time zone',false)],
  'public.episode_notifications': [col('id','integer',true,"nextval('episode_notifications_id_seq'::regclass)"),col('subscriber_id','character varying(64)'),col('episode_id','integer'),col('read_at','timestamp with time zone',false),col('created_at','timestamp with time zone',true,'now()')],
};
const pk = (name, keys) => ({name,type:'p',keys});
const fk = (name, key, target, targetKey) => ({name,type:'f',keys:[key],target,targetKeys:[targetKey]});
export const CONSTRAINTS = {
  'drizzle.__drizzle_migrations': [pk('__drizzle_migrations_pkey',['id'])],
  'public.subscribers': [pk('subscribers_pkey',['id'])],
  'public.anime_follows': [pk('anime_follows_subscriber_id_media_id_pk',['subscriber_id','media_id']),fk('anime_follows_subscriber_id_subscribers_id_fk','subscriber_id','public.subscribers','id'),fk('anime_follows_media_id_media_id_fk','media_id','public.media','id'),{name:'anime_follows_watch_status_check',type:'c',keys:['watch_status'],definition:"CHECK(watch_status=ANY(ARRAY['plan_to_watch','watching','continue','on_hold','watched']))"}],
  'public.episode_publications': [pk('episode_publications_pkey',['episode_id']),fk('episode_publications_episode_id_episodes_id_fk','episode_id','public.episodes','id'),fk('episode_publications_media_id_media_id_fk','media_id','public.media','id')],
  'public.episode_notifications': [pk('episode_notifications_pkey',['id']),fk('episode_notifications_subscriber_id_subscribers_id_fk','subscriber_id','public.subscribers','id'),fk('episode_notifications_episode_id_episode_publications_episode_id_fk','episode_id','public.episode_publications','episode_id')],
};
export const INDEXES = {
  'drizzle.__drizzle_migrations': [{name:'__drizzle_migrations_pkey',keys:['id'],unique:true,primary:true}],
  'public.subscribers': [{name:'subscribers_pkey',keys:['id'],unique:true,primary:true}],
  'public.anime_follows': [{name:'anime_follows_subscriber_id_media_id_pk',keys:['subscriber_id','media_id'],unique:true,primary:true},{name:'anime_follows_media_idx',keys:['media_id','subscriber_id'],unique:false,primary:false}],
  'public.episode_publications': [{name:'episode_publications_pkey',keys:['episode_id'],unique:true,primary:true},{name:'episode_publications_pending_idx',keys:['processed_at','published_at'],unique:false,primary:false}],
  'public.episode_notifications': [{name:'episode_notifications_pkey',keys:['id'],unique:true,primary:true},{name:'episode_notifications_subscriber_episode_unique',keys:['subscriber_id','episode_id'],unique:true,primary:false},{name:'episode_notifications_inbox_idx',keys:['subscriber_id','id'],unique:false,primary:false}],
};
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
const normalize = s => s?.replace(/::text\b/g,'').replace(/[\s"()]/g,'');
export const COLUMNS_SQL = `/* 0007:columns */ SELECT a.attname AS name,format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull AS required,
 pg_get_expr(d.adbin,d.adrelid) AS def,a.attidentity AS identity,a.attgenerated AS generated
 FROM pg_catalog.pg_attribute a LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
 WHERE a.attrelid=to_regclass($1) AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum`;
export function checkColumns(rows, expected) {
  insist(rows.length===expected.length,'column count mismatch');
  expected.forEach((e,i)=> { const r=rows[i]; insist(r.name===e.name && r.type===e.type && r.required===e.required && normalize(r.def)===normalize(e.def) && r.identity==='' && r.generated==='', 'column/default/NOT NULL mismatch'); });
}
export const CONSTRAINTS_SQL = `/* 0007:constraints */ SELECT k.conname AS name,k.contype AS type,k.convalidated AS valid,k.condeferrable AS deferrable,k.condeferred AS deferred,k.conislocal AS local,k.coninhcount AS inherited,
 ARRAY(SELECT a.attname FROM unnest(k.conkey) WITH ORDINALITY x(num,ord) JOIN pg_catalog.pg_attribute a ON a.attrelid=k.conrelid AND a.attnum=x.num ORDER BY x.ord) AS keys,
 CASE WHEN k.confrelid<>0 THEN (SELECT n.nspname||'.'||c.relname FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE c.oid=k.confrelid) END AS target,
 ARRAY(SELECT a.attname FROM unnest(k.confkey) WITH ORDINALITY x(num,ord) JOIN pg_catalog.pg_attribute a ON a.attrelid=k.confrelid AND a.attnum=x.num ORDER BY x.ord) AS "targetKeys",
 k.confdeltype AS deletion,k.confupdtype AS updating,k.confmatchtype AS matching,pg_get_constraintdef(k.oid) AS definition
 FROM pg_catalog.pg_constraint k WHERE k.conrelid=to_regclass($1) AND k.contype<>'n' ORDER BY k.conname`;
export function checkConstraints(rows, expected) {
  // PostgreSQL 18 NOT NULL constraints are excluded; attnotnull is checked separately.
  insist(rows.length===expected.length,'constraint count mismatch');
  for (const e of expected) {
    const r=rows.find(x=>x.name===e.name);
    insist(r && r.type===e.type && r.valid && !r.deferrable && !r.deferred && r.local && r.inherited===0 && same(r.keys,e.keys),'constraint definition mismatch');
    if (e.type==='f') insist(r.target===e.target && same(r.targetKeys,e.targetKeys) && r.deletion==='c' && r.updating==='a' && r.matching==='s','foreign key mismatch');
    if (e.type==='c') insist(normalize(r.definition)===normalize(e.definition),'watch-status CHECK mismatch');
  }
}
export const INDEXES_SQL = `/* 0007:indexes */ SELECT c.relname AS name,i.indisunique AS unique,i.indisprimary AS primary,i.indisvalid AS valid,i.indisready AS ready,i.indislive AS live,
 am.amname AS method,i.indnkeyatts AS keycount,i.indnatts AS totalcount,i.indoption::text AS options,i.indnullsnotdistinct AS nullsnotdistinct,
 pg_get_expr(i.indpred,i.indrelid) AS predicate,pg_get_expr(i.indexprs,i.indrelid) AS expressions,c.reloptions AS reloptions,
 ARRAY(SELECT a.attname FROM unnest(i.indkey::smallint[]) WITH ORDINALITY x(num,ord) LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=x.num ORDER BY x.ord) AS keys,
 NOT EXISTS(SELECT 1 FROM unnest(i.indclass::oid[]) WITH ORDINALITY x(op,ord) JOIN pg_catalog.pg_opclass o ON o.oid=x.op WHERE NOT o.opcdefault) AS default_opclasses,
 NOT EXISTS(SELECT 1 FROM unnest(i.indcollation::oid[]) WITH ORDINALITY x(coll,ord) JOIN unnest(i.indkey::smallint[]) WITH ORDINALITY y(num,ord) USING(ord) JOIN pg_catalog.pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=y.num WHERE x.coll<>a.attcollation) AS default_collations
 FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class c ON c.oid=i.indexrelid JOIN pg_catalog.pg_am am ON am.oid=c.relam WHERE i.indrelid=to_regclass($1)`;
export function checkIndexes(rows,expected) {
  insist(rows.length===expected.length,'index count mismatch');
  for(const e of expected) { const r=rows.find(x=>x.name===e.name); insist(r && same(r.keys,e.keys) && r.unique===e.unique && r.primary===e.primary && r.valid && r.ready && r.live && r.method==='btree' && r.keycount===e.keys.length && r.totalcount===e.keys.length && r.options===e.keys.map(()=>0).join(' ') && !r.predicate && !r.expressions && !r.reloptions && !r.nullsnotdistinct && r.default_opclasses && r.default_collations,'index definition mismatch'); }
}
export const RELATION_SQL = `/* 0007:relation */ SELECT c.relkind,c.relpersistence,c.relrowsecurity,c.relforcerowsecurity,pg_get_userbyid(c.relowner) AS owner,
 EXISTS(SELECT 1 FROM pg_catalog.pg_inherits WHERE inhrelid=c.oid OR inhparent=c.oid) AS inherits
 FROM pg_catalog.pg_class c WHERE c.oid=to_regclass($1)`;
export async function verifyTable(client,table,owner) {
  const r=(await client.query(RELATION_SQL,[table])).rows;
  insist(r.length===1 && r[0].relkind==='r' && r[0].relpersistence==='p' && !r[0].relrowsecurity && !r[0].relforcerowsecurity && !r[0].inherits && r[0].owner===owner,'relation ownership/kind mismatch');
  checkColumns((await client.query(COLUMNS_SQL,[table])).rows,TABLES[table]);
  checkConstraints((await client.query(CONSTRAINTS_SQL,[table])).rows,CONSTRAINTS[table]);
  checkIndexes((await client.query(INDEXES_SQL,[table])).rows,INDEXES[table]);
}
export const SEQUENCE_SQL = `/* 0007:sequence */ SELECT n.nspname||'.'||s.relname AS name,pg_get_userbyid(s.relowner) AS owner,s.relkind,s.relpersistence,
 q.seqtypid='pg_catalog.int4'::regtype AS int4,q.seqstart::text,q.seqincrement::text,q.seqmin::text,q.seqmax::text,q.seqcache::text,q.seqcycle,
 (SELECT count(*)::int FROM pg_catalog.pg_depend d WHERE d.classid='pg_catalog.pg_class'::regclass AND d.objid=s.oid AND d.refclassid='pg_catalog.pg_class'::regclass AND d.deptype IN ('a','i')) AS dependencies,
 EXISTS(SELECT 1 FROM pg_catalog.pg_depend d JOIN pg_catalog.pg_attribute a ON a.attrelid=d.refobjid AND a.attnum=d.refobjsubid WHERE d.classid='pg_catalog.pg_class'::regclass AND d.objid=s.oid AND d.refclassid='pg_catalog.pg_class'::regclass AND d.deptype='a' AND d.refobjid=to_regclass($2) AND a.attname='id') AS owned_by_id,
 EXISTS(SELECT 1 FROM pg_catalog.pg_attrdef ad JOIN pg_catalog.pg_attribute a ON a.attrelid=ad.adrelid AND a.attnum=ad.adnum JOIN pg_catalog.pg_depend d ON d.classid='pg_catalog.pg_attrdef'::regclass AND d.objid=ad.oid WHERE ad.adrelid=to_regclass($2) AND a.attname='id' AND d.refclassid='pg_catalog.pg_class'::regclass AND d.refobjid=s.oid AND d.deptype='n') AS default_depends,
 (SELECT count(*)::int FROM pg_catalog.pg_depend d WHERE d.classid='pg_catalog.pg_attrdef'::regclass AND d.refclassid='pg_catalog.pg_class'::regclass AND d.refobjid=s.oid AND d.deptype='n') AS default_dependents,
 has_sequence_privilege(current_user,s.oid,'USAGE') AND has_sequence_privilege(current_user,s.oid,'SELECT') AS privileges
 FROM pg_catalog.pg_class s JOIN pg_catalog.pg_namespace n ON n.oid=s.relnamespace JOIN pg_catalog.pg_sequence q ON q.seqrelid=s.oid WHERE s.oid=to_regclass($1)`;
export function checkSequence(rows,name,owner) {
  const r=rows[0]; insist(rows.length===1 && r.name===name && r.owner===owner && r.relkind==='S' && r.relpersistence==='p' && r.int4 && r.seqstart==='1' && r.seqincrement==='1' && r.seqmin==='1' && r.seqmax==='2147483647' && r.seqcache==='1' && !r.seqcycle && r.dependencies===1 && r.owned_by_id && r.default_depends && r.default_dependents===1 && r.privileges,'sequence definition/ownership/privilege mismatch');
}
export async function verifySequence(client,name,table,owner,ledger=false) {
  checkSequence((await client.query(SEQUENCE_SQL,[name,table])).rows,name,owner);
  if(ledger) {
    // Fixed qualified identifier only. SELECT does not call nextval/setval.
    const rows=(await client.query('/* 0007:sequence-state */ SELECT last_value::text,is_called FROM drizzle.__drizzle_migrations_id_seq')).rows;
    const r=rows[0]; insist(rows.length===1 && /^\d+$/.test(r.last_value),'sequence state unavailable');
    const next=BigInt(r.last_value)+(r.is_called?1n:0n);
    insist(next>7n && next<=2147483647n,'ledger sequence behind/exhausted');
  }
}
export const RESOLUTION_SQL = `/* 0007:resolution */ SELECT x.name,pg_catalog.to_regclass(x.name)::oid=pg_catalog.to_regclass('public.'||x.name)::oid AS correct
 FROM unnest($1::text[]) AS x(name)`;
export function checkResolution(rows,names) { insist(rows.length===names.length && names.every(name=>rows.some(r=>r.name===name && r.correct===true)),'application search_path resolves outside public'); }
export const ACL_SQL = `/* 0007:acl */ SELECT x.grantee::text,pg_get_userbyid(x.grantor) AS grantor,CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END AS recipient,x.privilege_type AS privilege,x.is_grantable AS grantable
 FROM pg_catalog.pg_class c CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault(CASE WHEN c.relkind='S' THEN 's'::"char" ELSE 'r'::"char" END,c.relowner))) x WHERE c.oid=to_regclass($1)`;
export const FUNCTION_ACL_SQL = `/* 0007:function-acl */ SELECT x.grantee::text,pg_get_userbyid(x.grantor) AS grantor,CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END AS recipient,x.privilege_type AS privilege,x.is_grantable AS grantable FROM pg_catalog.pg_proc p CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) x WHERE p.oid=to_regprocedure('public.vault_record_episode_publication()')`;
export function checkAcl(rows,owner,kind,allowPublicFunctionExecute,additive=false) {
  const required=kind==='table'?['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']:kind==='sequence'?['SELECT','UPDATE','USAGE']:['EXECUTE'];
  for(const r of rows) {
    const ownerEntry=r.recipient===owner && r.grantee!=='0' && r.grantor===owner && required.concat(kind==='table'?['MAINTAIN']:[]).includes(r.privilege);
    const publicEntry=kind==='function' && allowPublicFunctionExecute && r.grantee==='0' && r.recipient==='PUBLIC' && r.grantor===owner && r.privilege==='EXECUTE' && !r.grantable;
    insist(ownerEntry || publicEntry,'unexpected ACL recipient/grantor/privilege');
  }
  if(!additive) insist(required.every(p=>rows.some(r=>r.recipient===owner && r.grantee!=='0' && r.privilege===p)),'owner ACL incomplete');
}
export const DEFAULT_ACL_SQL = `/* 0007:default-acl */ WITH kinds(kind,code) AS (VALUES('table','r'::"char"),('sequence','S'::"char"),('function','f'::"char")),
 target AS(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=current_user), effective AS(
 SELECT k.kind,false AS additive,COALESCE(d.defaclacl,acldefault(CASE WHEN k.code='S' THEN 's'::"char" ELSE k.code END,t.oid)) AS acl FROM kinds k CROSS JOIN target t LEFT JOIN pg_catalog.pg_default_acl d ON d.defaclrole=t.oid AND d.defaclnamespace=0 AND d.defaclobjtype=k.code
 UNION ALL SELECT k.kind,true,d.defaclacl FROM kinds k CROSS JOIN target t JOIN pg_catalog.pg_default_acl d ON d.defaclrole=t.oid AND d.defaclnamespace='public'::regnamespace AND d.defaclobjtype=k.code)
 SELECT e.kind,e.additive,x.grantee::text,pg_get_userbyid(x.grantor) AS grantor,CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END AS recipient,x.privilege_type AS privilege,x.is_grantable AS grantable FROM effective e CROSS JOIN LATERAL aclexplode(e.acl) x`;
export async function verifyDefaults(client,m) {
  const rows=(await client.query(DEFAULT_ACL_SQL)).rows;
  for(const kind of ['table','sequence','function']) {
    checkAcl(rows.filter(r=>r.kind===kind && !r.additive),m.role,kind,m.allowPublicFunctionExecute);
    checkAcl(rows.filter(r=>r.kind===kind && r.additive),m.role,kind,m.allowPublicFunctionExecute,true);
  }
}
export const PRIVILEGES_SQL = `/* 0007:privileges */ SELECT label,ok FROM (
 SELECT 'public schema' AS label,has_schema_privilege(current_user,'public','USAGE') AND has_schema_privilege(current_user,'public','CREATE') AS ok
 UNION ALL SELECT 'drizzle schema',has_schema_privilege(current_user,'drizzle','USAGE')
 UNION ALL SELECT 'plpgsql',has_language_privilege(current_user,'plpgsql','USAGE')
 UNION ALL SELECT 'ledger',has_table_privilege(current_user,'drizzle.__drizzle_migrations','SELECT') AND has_table_privilege(current_user,'drizzle.__drizzle_migrations','INSERT') AND
 (has_table_privilege(current_user,'drizzle.__drizzle_migrations','UPDATE') OR has_table_privilege(current_user,'drizzle.__drizzle_migrations','DELETE') OR has_table_privilege(current_user,'drizzle.__drizzle_migrations','TRUNCATE'))
 UNION ALL SELECT t,has_table_privilege(current_user,'public.'||t,'SELECT') AND
 (has_table_privilege(current_user,'public.'||t,'UPDATE') OR has_table_privilege(current_user,'public.'||t,'DELETE') OR has_table_privilege(current_user,'public.'||t,'TRUNCATE')) FROM unnest(ARRAY['media','seasons','episodes','download_links']) x(t)
 UNION ALL SELECT 'media reference',has_column_privilege(current_user,'public.media','id','REFERENCES')
 UNION ALL SELECT 'episode reference',has_column_privilege(current_user,'public.episodes','id','REFERENCES')
 UNION ALL SELECT 'link trigger',has_table_privilege(current_user,'public.download_links','TRIGGER')
 ) checks`;
export async function verifyPrivileges(client) {
  const rows=(await client.query(PRIVILEGES_SQL)).rows;
  insist(rows.length===11 && rows.every(r=>r.ok===true),'installation privileges missing');
}
