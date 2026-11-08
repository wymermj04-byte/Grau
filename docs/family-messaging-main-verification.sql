-- READ ONLY — Grau Zero Family Messaging Main preflight and post-deployment checks.
--
-- Run these statements in the intended Main Supabase project only. They do not
-- create, update, delete, grant, revoke, or execute any messaging RPC. Before
-- running anything, confirm the Dashboard project reference is
-- vclasuabrhzzkcysyawv. SQL alone cannot prove the Supabase Dashboard project
-- reference, so that visual confirmation is a required human safety check.

begin read only;

-- 1. Record the connected database identity and execution role in the review.
select current_database() as database_name, current_user as execution_role, version() as postgres_version;

-- 2. Required existing relations and Main columns. Every expected row must be
-- returned with the shown data type before applying family-messaging-phase1.sql.
select c.table_name, c.column_name, c.data_type, c.udt_name, c.is_nullable
from information_schema.columns as c
where c.table_schema = 'public'
  and (
    (c.table_name = 'gym_settings' and c.column_name in ('id', 'gym_name'))
    or (c.table_name = 'gym_staff' and c.column_name in ('user_id', 'gym_id', 'role', 'is_active'))
    or (c.table_name = 'member_account_links' and c.column_name in ('user_id', 'gym_id', 'student_id', 'status', 'approved_at', 'revoked_at'))
  )
order by c.table_name, c.ordinal_position;

-- 3. Confirm the reviewed gym_staff key order is exactly (user_id, gym_id).
select con.conname, con.contype, array_agg(att.attname order by key_part.ordinality) as key_columns
from pg_constraint as con
join unnest(con.conkey) with ordinality as key_part(attnum, ordinality) on true
join pg_attribute as att on att.attrelid = con.conrelid and att.attnum = key_part.attnum
where con.conrelid = 'public.gym_staff'::regclass and con.contype in ('p', 'u')
group by con.conname, con.contype
order by con.contype, con.conname;

-- 4. Confirm family-link approval/revocation records use the expected values.
-- This reports only aggregate counts, not family details.
select status, (revoked_at is null) as has_no_revocation, count(*) as link_count
from public.member_account_links
group by status, (revoked_at is null)
order by status, has_no_revocation;

-- 5. Confirm staff roles and active flags use the expected live vocabulary.
select role, is_active, count(*) as membership_count
from public.gym_staff
group by role, is_active
order by role, is_active;

-- 6. Review existing RLS state and policies. The messaging migration does not
-- alter any of these existing policies.
select cls.relname as table_name, cls.relrowsecurity as rls_enabled, cls.relforcerowsecurity as rls_forced
from pg_class as cls
join pg_namespace as ns on ns.oid = cls.relnamespace
where ns.nspname = 'public'
  and cls.relname in ('gym_settings', 'gym_staff', 'member_account_links')
order by cls.relname;

select pol.polrelid::regclass::text as table_name, pol.polname, pol.polcmd, pol.polroles::regrole[] as roles,
       pg_get_expr(pol.polqual, pol.polrelid) as using_expression,
       pg_get_expr(pol.polwithcheck, pol.polrelid) as check_expression
from pg_policy as pol
where pol.polrelid in ('public.gym_settings'::regclass, 'public.gym_staff'::regclass, 'public.member_account_links'::regclass)
order by table_name, pol.polname;

-- 7. Confirm every built-in dependency used by the migration exists. It does
-- not depend on an existing messaging function.
select to_regprocedure('auth.uid()') as auth_uid_function,
       to_regprocedure('gen_random_uuid()') as uuid_function,
       to_regprocedure('pg_catalog.hashtextextended(text,bigint)') as advisory_hash_function,
       to_regprocedure('pg_catalog.pg_advisory_xact_lock(bigint)') as advisory_lock_function,
       current_user = 'postgres' as will_security_definer_objects_be_postgres_owned;

-- 8. Collision check. Every result must be false/null before this initial
-- migration is run. A true result means stop; do not use CREATE OR REPLACE.
select candidate.name, to_regclass('public.' || candidate.name) is not null as relation_exists
from (values ('gym_staff_profiles'), ('family_staff_conversations'), ('family_staff_messages'), ('family_staff_conversation_reads'), ('family_staff_read_cursors')) as candidate(name)
order by candidate.name;

select candidate.signature, to_regprocedure('public.' || candidate.signature) is not null as function_exists
from (values
  ('family_staff_is_active_staff(bigint)'), ('family_staff_is_active_admin(bigint)'), ('family_staff_is_approved_family(bigint)'),
  ('family_staff_require_conversation(bigint)'), ('family_staff_require_conversation(bigint,text)'), ('family_staff_resolve_inbox_label(bigint,bigint,uuid)'),
  ('family_staff_messages_immutable()'), ('family_staff_upsert_staff_profile(uuid,bigint,text)'),
  ('family_staff_get_or_create_conversation(bigint)'), ('family_staff_send_family_message(bigint,text,uuid)'),
  ('family_staff_send_staff_message(bigint,text,uuid)'), ('family_staff_list_family_conversations()'),
  ('family_staff_list_staff_conversations(bigint)'), ('family_staff_list_message_history(bigint,bigint,integer)'), ('family_staff_list_message_history(bigint,text,bigint,integer)'),
  ('family_staff_open_unread_page(bigint,integer)'), ('family_staff_open_unread_page(bigint,text,integer)'), ('family_staff_acknowledge_read(bigint,uuid,bigint)'), ('family_staff_acknowledge_read(bigint,text,uuid,bigint)'),
  ('family_staff_purge_expired_read_cursors(timestamptz)')
) as candidate(signature)
order by candidate.signature;

rollback;

-- POST-DEPLOYMENT READ-ONLY REVIEW (run only after the approved migration).
-- This section inspects metadata only. It does not invoke a messaging RPC or
-- read message bodies.
begin read only;

-- 9. All five new tables must exist and have RLS enabled. There must be no
-- direct RLS policies because RPCs are the only client interface. A missing
-- table is reported as an explicit failure rather than silently omitted.
with expected(table_name) as (
  values
    ('gym_staff_profiles'),
    ('family_staff_conversations'),
    ('family_staff_messages'),
    ('family_staff_conversation_reads'),
    ('family_staff_read_cursors')
)
select expected.table_name,
       cls.relkind,
       cls.relrowsecurity as rls_enabled,
       cls.relforcerowsecurity as rls_forced,
       count(pol.oid) as policy_count,
       case
         when cls.oid is null then 'FAIL: missing table'
         when cls.relkind <> 'r' then 'FAIL: unexpected relation kind'
         when not cls.relrowsecurity then 'FAIL: RLS disabled'
         when count(pol.oid) <> 0 then 'FAIL: direct policy exists'
         else 'PASS'
       end as verification_result
from expected
left join pg_class as cls
  on cls.relnamespace = 'public'::regnamespace
 and cls.relname = expected.table_name
left join pg_policy as pol on pol.polrelid = cls.oid
group by expected.table_name, cls.oid, cls.relkind,
         cls.relrowsecurity, cls.relforcerowsecurity
order by expected.table_name;

-- 10. authenticated and anon must both have no direct table or sequence
-- privilege. A missing object is also an explicit failure.
with expected(table_name) as (
  values
    ('gym_staff_profiles'),
    ('family_staff_conversations'),
    ('family_staff_messages'),
    ('family_staff_conversation_reads'),
    ('family_staff_read_cursors')
)
select expected.table_name,
       has_table_privilege('authenticated', cls.oid, 'select') as authenticated_select,
       has_table_privilege('authenticated', cls.oid, 'insert') as authenticated_insert,
       has_table_privilege('authenticated', cls.oid, 'update') as authenticated_update,
       has_table_privilege('authenticated', cls.oid, 'delete') as authenticated_delete,
       has_table_privilege('anon', cls.oid, 'select') as anon_select,
       has_table_privilege('anon', cls.oid, 'insert') as anon_insert,
       has_table_privilege('anon', cls.oid, 'update') as anon_update,
       has_table_privilege('anon', cls.oid, 'delete') as anon_delete,
       case
         when cls.oid is null then 'FAIL: missing table'
         when has_table_privilege('authenticated', cls.oid, 'select')
           or has_table_privilege('authenticated', cls.oid, 'insert')
           or has_table_privilege('authenticated', cls.oid, 'update')
           or has_table_privilege('authenticated', cls.oid, 'delete')
           or has_table_privilege('anon', cls.oid, 'select')
           or has_table_privilege('anon', cls.oid, 'insert')
           or has_table_privilege('anon', cls.oid, 'update')
           or has_table_privilege('anon', cls.oid, 'delete')
           then 'FAIL: direct table privilege granted'
         else 'PASS'
       end as verification_result
from expected
left join pg_class as cls
  on cls.relnamespace = 'public'::regnamespace
 and cls.relname = expected.table_name
order by expected.table_name;

with expected(sequence_name) as (
  values ('family_staff_conversations_id_seq'), ('family_staff_messages_id_seq')
)
select expected.sequence_name,
       has_sequence_privilege('authenticated', cls.oid, 'usage') as authenticated_usage,
       has_sequence_privilege('authenticated', cls.oid, 'select') as authenticated_select,
       has_sequence_privilege('authenticated', cls.oid, 'update') as authenticated_update,
       has_sequence_privilege('anon', cls.oid, 'usage') as anon_usage,
       has_sequence_privilege('anon', cls.oid, 'select') as anon_select,
       has_sequence_privilege('anon', cls.oid, 'update') as anon_update,
       case
         when cls.oid is null then 'FAIL: missing sequence'
         when has_sequence_privilege('authenticated', cls.oid, 'usage')
           or has_sequence_privilege('authenticated', cls.oid, 'select')
           or has_sequence_privilege('authenticated', cls.oid, 'update')
           or has_sequence_privilege('anon', cls.oid, 'usage')
           or has_sequence_privilege('anon', cls.oid, 'select')
           or has_sequence_privilege('anon', cls.oid, 'update')
           then 'FAIL: direct sequence privilege granted'
         else 'PASS'
       end as verification_result
from expected
left join pg_class as cls
  on cls.relnamespace = 'public'::regnamespace
 and cls.relname = expected.sequence_name
 and cls.relkind = 'S'
order by expected.sequence_name;

-- 11. The nine public RPCs must be postgres-owned SECURITY DEFINER functions
-- with the fixed safe search_path. Only authenticated receives EXECUTE.
with expected(signature) as (
  values
    ('family_staff_upsert_staff_profile(uuid,bigint,text)'),
    ('family_staff_get_or_create_conversation(bigint)'),
    ('family_staff_send_family_message(bigint,text,uuid)'),
    ('family_staff_send_staff_message(bigint,text,uuid)'),
    ('family_staff_list_family_conversations()'),
    ('family_staff_list_staff_conversations(bigint)'),
    ('family_staff_list_message_history(bigint,text,bigint,integer)'),
    ('family_staff_open_unread_page(bigint,text,integer)'),
    ('family_staff_acknowledge_read(bigint,text,uuid,bigint)')
)
select expected.signature,
       p.oid::regprocedure::text as deployed_signature,
       pg_get_userbyid(p.proowner) as owner,
       p.prosecdef as security_definer,
       p.proconfig as function_config,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated_can_execute,
       has_function_privilege('anon', p.oid, 'execute') as anon_can_execute,
       exists (
         select 1
         from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) as acl
         where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
       ) as public_can_execute,
       case
         when p.oid is null then 'FAIL: missing public RPC'
         when pg_get_userbyid(p.proowner) <> 'postgres' then 'FAIL: unexpected owner'
         when not p.prosecdef then 'FAIL: not SECURITY DEFINER'
         when p.proconfig is null
           or not (p.proconfig @> array['search_path=pg_catalog, public, pg_temp'])
           then 'FAIL: unsafe or missing search_path'
         when not has_function_privilege('authenticated', p.oid, 'execute')
           then 'FAIL: authenticated EXECUTE missing'
         when has_function_privilege('anon', p.oid, 'execute') then 'FAIL: anon EXECUTE granted'
         when exists (
           select 1
           from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) as acl
           where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
         ) then 'FAIL: PUBLIC EXECUTE granted'
         else 'PASS'
       end as verification_result
from expected
left join pg_proc as p on p.oid = to_regprocedure('public.' || expected.signature)
order by expected.signature;

-- 12. Internal helpers must remain uncallable by authenticated and PUBLIC.
with internal(signature) as (
  values
    ('family_staff_is_active_staff(bigint)'),
    ('family_staff_is_active_admin(bigint)'),
    ('family_staff_is_approved_family(bigint)'),
    ('family_staff_require_conversation(bigint,text)'),
    ('family_staff_resolve_inbox_label(bigint,bigint,uuid)'),
    ('family_staff_messages_immutable()'),
    ('family_staff_purge_expired_read_cursors(timestamptz)')
)
select internal.signature,
       p.oid::regprocedure::text as deployed_signature,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated_can_execute,
       has_function_privilege('anon', p.oid, 'execute') as anon_can_execute,
       exists (
         select 1
         from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) as acl
         where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
       ) as public_can_execute,
       case
         when p.oid is null then 'FAIL: missing internal helper'
         when has_function_privilege('authenticated', p.oid, 'execute')
           then 'FAIL: authenticated EXECUTE granted'
         when has_function_privilege('anon', p.oid, 'execute')
           then 'FAIL: anon EXECUTE granted'
         when exists (
           select 1
           from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) as acl
           where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
         ) then 'FAIL: PUBLIC EXECUTE granted'
         else 'PASS'
       end as verification_result
from internal
left join pg_proc as p on p.oid = to_regprocedure('public.' || internal.signature)
order by internal.signature;

-- 13. Review new constraints and the immutable-message trigger.
select con.conrelid::regclass::text as table_name,
       con.conname,
       pg_get_constraintdef(con.oid) as definition
from pg_constraint as con
where con.conrelid in (
  'public.gym_staff_profiles'::regclass,
  'public.family_staff_conversations'::regclass,
  'public.family_staff_messages'::regclass,
  'public.family_staff_conversation_reads'::regclass,
  'public.family_staff_read_cursors'::regclass
)
order by table_name, con.conname;

select tgrelid::regclass::text as table_name,
       tgname,
       pg_get_triggerdef(oid) as definition
from pg_trigger
where tgrelid = 'public.family_staff_messages'::regclass
  and not tgisinternal;

rollback;
