-- FUTURE read-only evidence collection on test-0007-migration ONLY.
-- Not executed during preparation. Run only after explicit verification approval.
-- These queries do not prove Neon branch identity; retain control-plane evidence.
-- Stop if installer outcome is uncertain: investigate rather than rerunning it.
SELECT pg_catalog.current_database() AS database,
 current_user AS role, session_user AS session_role,
 pg_catalog.current_setting('server_version_num') AS version;

SELECT id,hash,created_at FROM drizzle.__drizzle_migrations ORDER BY id;
-- Original seven exact baseline rows unchanged; exactly one new hash/time pair.
SELECT count(*) AS matching_0007 FROM drizzle.__drizzle_migrations
 WHERE hash='d6c108d47c5c45a4ff16b17ea5e07ca45f2c71b7d1e1a851a5d7143fb3c14666'
 AND created_at=1793806633286;

-- Owner neondb_owner, SECURITY INVOKER (security_definer=false), no settings,
-- trigger return type. Compare body and other properties with original SQL and
-- installer contract; the installer already asserts these before COMMIT.
SELECT p.oid::regprocedure AS function_name,
 pg_catalog.pg_get_userbyid(p.proowner) AS owner,
 p.prosecdef AS security_definer,p.proconfig AS settings,
 pg_catalog.pg_get_function_result(p.oid) AS result_type,
 pg_catalog.pg_get_functiondef(p.oid) AS definition
 FROM pg_catalog.pg_proc p
 WHERE p.oid=pg_catalog.to_regprocedure('public.vault_record_episode_publication()');

-- Owner EXECUTE required. No PUBLIC or other recipients permitted.
SELECT pg_catalog.pg_get_userbyid(p.proowner) AS owner,
 pg_catalog.pg_get_userbyid(a.grantor) AS grantor,
 CASE WHEN a.grantee=0 THEN 'PUBLIC'
 ELSE pg_catalog.pg_get_userbyid(a.grantee) END AS recipient,
 a.privilege_type,a.is_grantable
 FROM pg_catalog.pg_proc p
 CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(
 p.proacl,pg_catalog.acldefault('f'::"char",p.proowner))) a
 WHERE p.oid=pg_catalog.to_regprocedure('public.vault_record_episode_publication()');

-- Exactly the intended enabled trigger; inspect event/UPDATE OF definition.
SELECT t.tgname,t.tgenabled,t.tgtype,t.tgfoid::regprocedure,
 pg_catalog.pg_get_triggerdef(t.oid) AS definition
 FROM pg_catalog.pg_trigger t
 WHERE t.tgrelid=pg_catalog.to_regclass('public.download_links')
 AND t.tgname='vault_episode_first_link' AND NOT t.tgisinternal;

-- Immediately after installation under maintenance, pending should be zero.
-- Later isolated publication tests may deliberately create pending work.
SELECT count(*) AS publications,
 count(*) FILTER(WHERE processed_at IS NULL) AS pending
 FROM public.episode_publications;

-- Full optional catalog/backfill evidence: scripts/migrations/0007-verify.sql.
-- Its generic PUBLIC-function comment does NOT override rehearsal owner-only policy.
-- This file is not an automated assertion runner or a functional notification test.
