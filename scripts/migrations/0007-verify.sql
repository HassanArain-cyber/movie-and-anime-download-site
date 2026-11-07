-- READ-ONLY review queries for the pinned 0007 installation. NOT an installer.
-- Execute only after separate approval on the verified direct endpoint as the
-- actual application role with its original login settings. All statements SELECT.
-- Results are review evidence, not automatic assertions or Production approval.
SELECT current_database(),current_user,session_user,current_schemas(true),
 current_setting('search_path'),current_setting('server_version_num');
SELECT id,hash,created_at FROM drizzle.__drizzle_migrations ORDER BY id;
SELECT count(*) AS matching_0007 FROM drizzle.__drizzle_migrations
 WHERE hash='d6c108d47c5c45a4ff16b17ea5e07ca45f2c71b7d1e1a851a5d7143fb3c14666' AND created_at=1793806633286;
-- Expect original seven exact entries unchanged and exactly one matching new pair.

-- Effective application resolution: every name must resolve to the public object.
SELECT name,to_regclass(name) AS resolved,to_regclass('public.'||name) AS intended,
 to_regclass(name)::oid=to_regclass('public.'||name)::oid AS correct
 FROM unnest(ARRAY['media','seasons','episodes','download_links','subscribers',
 'anime_follows','episode_publications','episode_notifications']) names(name);

-- Relation ownership/kind/RLS/inheritance; new objects must be owned by the
-- approved application/execution role, ledger by its separately approved owner.
SELECT n.nspname,c.relname,c.relkind,c.relpersistence,pg_get_userbyid(c.relowner) AS owner,
 c.relrowsecurity,c.relforcerowsecurity,EXISTS(SELECT 1 FROM pg_catalog.pg_inherits
 WHERE inhrelid=c.oid OR inhparent=c.oid) AS inherits
 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 WHERE c.oid IN ('drizzle.__drizzle_migrations'::regclass,'public.subscribers'::regclass,
 'public.anime_follows'::regclass,'public.episode_publications'::regclass,'public.episode_notifications'::regclass);

-- Exact column order/type/default, NOT NULL, no identity/generated substitution.
SELECT n.nspname,c.relname,a.attnum,a.attname,format_type(a.atttypid,a.atttypmod) AS type,
 a.attnotnull,pg_get_expr(d.adbin,d.adrelid) AS default_expression,a.attidentity,a.attgenerated
 FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid=a.attrelid
 JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
 WHERE a.attnum>0 AND NOT a.attisdropped AND c.oid IN
 ('drizzle.__drizzle_migrations'::regclass,'public.subscribers'::regclass,'public.anime_follows'::regclass,
 'public.episode_publications'::regclass,'public.episode_notifications'::regclass)
 ORDER BY n.nspname,c.relname,a.attnum;

-- PostgreSQL 18 NOT NULL constraints are NOT counted as PK/FK/CHECK constraints.
-- Four new-table PKs, six FKs and one status CHECK; ledger has its own PK.
SELECT k.conrelid::regclass,k.conname,k.contype,k.convalidated,k.condeferrable,
 k.condeferred,k.conislocal,k.coninhcount,k.confrelid::regclass,k.conkey,k.confkey,
 k.confdeltype,k.confupdtype,k.confmatchtype,pg_get_constraintdef(k.oid)
 FROM pg_catalog.pg_constraint k WHERE k.contype<>'n' AND k.conrelid IN
 ('drizzle.__drizzle_migrations'::regclass,'public.subscribers'::regclass,'public.anime_follows'::regclass,
 'public.episode_publications'::regclass,'public.episode_notifications'::regclass)
 ORDER BY k.conrelid::regclass::text,k.conname;

-- Every index: exact keys, uniqueness, method, no INCLUDE, expressions, predicate,
-- alternate opclass/collation, descending flags or NULLS NOT DISTINCT changes.
SELECT i.indrelid::regclass,i.indexrelid::regclass,i.indisprimary,i.indisunique,
 i.indisvalid,i.indisready,i.indislive,i.indnkeyatts,i.indnatts,i.indoption,i.indclass,
 i.indcollation,i.indnullsnotdistinct,c.reloptions,am.amname,pg_get_indexdef(i.indexrelid)
 FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class c ON c.oid=i.indexrelid
 JOIN pg_catalog.pg_am am ON am.oid=c.relam WHERE i.indrelid IN
 ('drizzle.__drizzle_migrations'::regclass,'public.subscribers'::regclass,'public.anime_follows'::regclass,
 'public.episode_publications'::regclass,'public.episode_notifications'::regclass);

-- Sequence definitions and owner. SELECT only: never nextval/setval/reset.
SELECT c.oid::regclass,pg_get_userbyid(c.relowner) AS owner,c.relpersistence,
 q.seqtypid::regtype,q.seqstart,q.seqincrement,q.seqmin,q.seqmax,q.seqcache,q.seqcycle
 FROM pg_catalog.pg_sequence q JOIN pg_catalog.pg_class c ON c.oid=q.seqrelid
 WHERE c.oid IN ('drizzle.__drizzle_migrations_id_seq'::regclass,'public.episode_notifications_id_seq'::regclass);
SELECT last_value,is_called FROM drizzle.__drizzle_migrations_id_seq;
SELECT last_value,is_called FROM public.episode_notifications_id_seq;
SELECT pg_get_serial_sequence('drizzle.__drizzle_migrations','id'),
 pg_get_serial_sequence('public.episode_notifications','id');
-- Must have exactly one automatic ('a') sequence->table.id ownership dependency.
SELECT d.objid::regclass AS sequence,d.deptype,d.refobjid::regclass AS owned_table,a.attname
 FROM pg_catalog.pg_depend d JOIN pg_catalog.pg_attribute a ON a.attrelid=d.refobjid AND a.attnum=d.refobjsubid
 WHERE d.classid='pg_catalog.pg_class'::regclass AND d.refclassid='pg_catalog.pg_class'::regclass
 AND d.objid IN ('drizzle.__drizzle_migrations_id_seq'::regclass,'public.episode_notifications_id_seq'::regclass)
 AND d.deptype IN ('a','i');
-- The actual ID default must depend normally ('n') on the expected sequence.
SELECT ad.adrelid::regclass,a.attname,d.refobjid::regclass AS referenced_sequence,d.deptype,
 pg_get_expr(ad.adbin,ad.adrelid) AS default_expression
 FROM pg_catalog.pg_attrdef ad JOIN pg_catalog.pg_attribute a ON a.attrelid=ad.adrelid AND a.attnum=ad.adnum
 JOIN pg_catalog.pg_depend d ON d.classid='pg_catalog.pg_attrdef'::regclass AND d.objid=ad.oid
 WHERE a.attname='id' AND ad.adrelid IN ('drizzle.__drizzle_migrations'::regclass,'public.episode_notifications'::regclass)
 AND d.refclassid='pg_catalog.pg_class'::regclass AND d.refobjid IN
 ('drizzle.__drizzle_migrations_id_seq'::regclass,'public.episode_notifications_id_seq'::regclass);

-- Detect unexpected other defaults sharing either serial sequence.
SELECT d.refobjid::regclass AS sequence,count(*) AS default_dependents
 FROM pg_catalog.pg_depend d WHERE d.classid='pg_catalog.pg_attrdef'::regclass
 AND d.refclassid='pg_catalog.pg_class'::regclass AND d.deptype='n' AND d.refobjid IN
 ('drizzle.__drizzle_migrations_id_seq'::regclass,'public.episode_notifications_id_seq'::regclass)
 GROUP BY d.refobjid;
-- Expect one default-dependent per sequence.

-- Exact original function body AND execution properties/owner.
SELECT p.oid::regprocedure,pg_get_userbyid(p.proowner),l.lanname,p.prokind,
 p.prosecdef,p.proleakproof,p.proisstrict,p.proretset,p.provolatile,p.proparallel,p.proconfig,
 p.prorettype::regtype,pg_get_functiondef(p.oid)
 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid=p.prolang
 WHERE p.oid='public.vault_record_episode_publication()'::regprocedure;
-- Exact UPDATE OF order and event bits (21), enabled O, no condition/arguments or
-- transition tables; not just the name and function.
SELECT t.tgname,t.tgtype,t.tgenabled,t.tgfoid::regprocedure,t.tgconstraint,
 t.tgdeferrable,t.tginitdeferred,t.tgnargs,t.tgoldtable,t.tgnewtable,
 pg_get_expr(t.tgqual,t.tgrelid) AS condition,
 ARRAY(SELECT a.attname FROM unnest(t.tgattr::smallint[]) WITH ORDINALITY x(num,ord)
 JOIN pg_catalog.pg_attribute a ON a.attrelid=t.tgrelid AND a.attnum=x.num ORDER BY x.ord) AS update_columns,
 pg_get_triggerdef(t.oid) FROM pg_catalog.pg_trigger t
 WHERE t.tgrelid='public.download_links'::regclass AND NOT t.tgisinternal;

-- Resulting effective ACLs: owner-only tables/sequence; PUBLIC EXECUTE on the
-- invoker trigger function is allowed ONLY if explicitly approved in manifest.
SELECT c.oid::regclass,pg_get_userbyid(c.relowner) AS owner,pg_get_userbyid(x.grantor) AS grantor,
 CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END AS recipient,x.privilege_type,x.is_grantable
 FROM pg_catalog.pg_class c CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,
 acldefault(CASE WHEN c.relkind='S' THEN 's'::"char" ELSE 'r'::"char" END,c.relowner))) x
 WHERE c.oid IN ('public.subscribers'::regclass,'public.anime_follows'::regclass,
 'public.episode_publications'::regclass,'public.episode_notifications'::regclass,'public.episode_notifications_id_seq'::regclass);
SELECT p.oid::regprocedure,pg_get_userbyid(p.proowner) AS owner,pg_get_userbyid(x.grantor) AS grantor,
 CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END AS recipient,x.privilege_type,x.is_grantable
 FROM pg_catalog.pg_proc p CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) x
 WHERE p.oid='public.vault_record_episode_publication()'::regprocedure;
-- Explicit default ACL records. NULL defaults must ALSO be interpreted using
-- acldefault: the stock global function ACL includes PUBLIC EXECUTE.
SELECT pg_get_userbyid(d.defaclrole),d.defaclnamespace::regnamespace,d.defaclobjtype,
 CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END AS recipient,
 pg_get_userbyid(x.grantor),x.privilege_type,x.is_grantable
 FROM pg_catalog.pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) x
 WHERE d.defaclrole=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=current_user)
 AND d.defaclnamespace IN (0,'public'::regnamespace) AND d.defaclobjtype IN ('r','S','f');
SELECT 'stock function ACL' AS label,acldefault('f',(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=current_user));

-- Types across schemas: only the intended public feature row/array types should
-- exist after installation. Review any standalone enum/domain or foreign copy.
SELECT n.nspname,t.typname,t.typtype,t.typrelid::regclass FROM pg_catalog.pg_type t
 JOIN pg_catalog.pg_namespace n ON n.oid=t.typnamespace
 WHERE t.typname ~ '^_?(subscribers|anime_follows|episode_publications|episode_notifications)(_|$)';

SELECT count(*) AS missing_publications FROM public.episodes e
 JOIN public.media m ON m.id=e.media_id JOIN public.seasons s ON s.id=e.season_id
 WHERE m.type IN ('anime','series') AND EXISTS(SELECT 1 FROM public.download_links d WHERE d.episode_id=e.id AND
 (d.url ~* '^(https?://[^/[:space:]]+|tg:|magnet:)' OR d.url LIKE '/uploads/%'
 OR (d.storage_provider='r2' AND d.object_key IS NOT NULL AND length(d.object_key)>0)))
 AND NOT EXISTS(SELECT 1 FROM public.episode_publications p WHERE p.episode_id=e.id);
SELECT count(*) AS publications,count(*) FILTER(WHERE processed_at IS NULL) AS pending FROM public.episode_publications;
SELECT t,p,has_table_privilege(current_user,'public.'||t,p) AS allowed
 FROM unnest(ARRAY['subscribers','anime_follows','episode_publications','episode_notifications']) AS tables(t)
 CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']) AS privileges(p);
SELECT has_sequence_privilege(current_user,'public.episode_notifications_id_seq','USAGE'),
 has_sequence_privilege(current_user,'public.episode_notifications_id_seq','SELECT');
-- Missing coverage must be zero. Pending is zero immediately under maintenance;
-- new writes after resumption can legitimately create pending work. Compare all
-- original content counts/checksums to independently captured backup baselines.
-- Functional Follow/notifications tests require separate write-test permission.
