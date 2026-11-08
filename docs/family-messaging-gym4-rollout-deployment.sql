-- REVIEW ONLY — the sixteen baseline hashes below were supplied by the
-- approved Main read-only inventory. This script is a single transaction and
-- still deliberately aborts if any placeholder is introduced or remains.
--
-- Scope: a Gym 4-only server rollout gate. It changes six existing function
-- definitions and creates one private helper. It does not alter messaging
-- tables, rows, RLS, public RPC signatures, grants, cursor state, messages,
-- acknowledgements, or application feature flags.

begin;

-- The supplied manifest is a deployment input, not an observation made by this
-- transaction. Its reviewed values came from the separately approved
-- read-only inventory and must never be edited without a new inventory.
create temporary table _gz_expected_functions (
  signature text primary key,
  function_name text not null,
  result_contract text not null,
  language_name name not null,
  volatility "char" not null,
  security_definer boolean not null,
  owner_name name not null,
  function_config text[] not null,
  definition_md5 text not null,
  acl_md5 text not null,
  acl_is_default text not null,
  api_contract text not null check (api_contract in ('public-rpc','internal'))
) on commit drop;

insert into _gz_expected_functions values
  ('family_staff_is_active_staff(bigint)', 'family_staff_is_active_staff', 'boolean', 'sql', 's', true, 'postgres', array['search_path=pg_catalog, public, pg_temp'], 'e931634fa2b6b505e197b03278f24d6a', 'db23e67d6fad77fdfa003856d807d6af', 'false', 'internal'),
  ('family_staff_is_active_admin(bigint)', 'family_staff_is_active_admin', 'boolean', 'sql', 's', true, 'postgres', array['search_path=pg_catalog, public, pg_temp'], 'fb738b850c0dc91ebc0df16c96bddf44', 'db23e67d6fad77fdfa003856d807d6af', 'false', 'internal'),
  ('family_staff_is_approved_family(bigint)', 'family_staff_is_approved_family', 'boolean', 'sql', 's', true, 'postgres', array['search_path=pg_catalog, public, pg_temp'], '03b675bfbf601854de16efd647cd1d8e', 'db23e67d6fad77fdfa003856d807d6af', 'false', 'internal'),
  ('family_staff_require_conversation(bigint,text)', 'family_staff_require_conversation', 'family_staff_conversations', 'plpgsql', 's', true, 'postgres', array['search_path=pg_catalog, public, pg_temp'], '73c2585c0740ca6d59452bceb7104c31', 'db23e67d6fad77fdfa003856d807d6af', 'false', 'internal'),
  ('family_staff_resolve_inbox_label(bigint,bigint,uuid)', 'family_staff_resolve_inbox_label', 'text', 'plpgsql', 's', true, 'postgres', array['search_path=pg_catalog, public, pg_temp'], 'c5cfe39c80e960651b1b430d60dc0f2e', 'db23e67d6fad77fdfa003856d807d6af', 'false', 'internal'),
  ('family_staff_messages_immutable()', 'family_staff_messages_immutable', 'trigger', 'plpgsql', 'v', true, 'postgres', array['search_path=pg_catalog, public, pg_temp'], 'b4dd1f886298c925a797bc9d1a96f19c', 'db23e67d6fad77fdfa003856d807d6af', 'false', 'internal'),
  ('family_staff_upsert_staff_profile(uuid,bigint,text)', 'family_staff_upsert_staff_profile', 'public.gym_staff_profiles', 'plpgsql', 'v', true, 'postgres', array['search_path=pg_catalog, public, pg_temp'], '47e2e432b6a6ed6ceb704db1fc512fc5', '06c8bd810f2d9a52a993cd903c13793a', 'false', 'public-rpc'),
  ('family_staff_get_or_create_conversation(bigint)', 'family_staff_get_or_create_conversation', 'TABLE(conversation_id bigint, gym_id bigint, created_at timestamp with time zone)', 'plpgsql', 'v', true, 'postgres', array['search_path=pg_catalog, public, pg_temp'], 'd1736f6a82d86b39a09790f5209d9bfc', '06c8bd810f2d9a52a993cd903c13793a', 'false', 'public-rpc'),
  ('family_staff_send_family_message(bigint,text,uuid)', 'family_staff_send_family_message', 'TABLE(conversation_id bigint, message_id bigint, created_at timestamp with time zone)', 'plpgsql', 'v', true, 'postgres', array['search_path=pg_catalog, public, pg_temp'], '1b6cf14419cfdff6b2d99187fe321d30', '06c8bd810f2d9a52a993cd903c13793a', 'false', 'public-rpc'),
  ('family_staff_send_staff_message(bigint,text,uuid)', 'family_staff_send_staff_message', 'TABLE(conversation_id bigint, message_id bigint, created_at timestamp with time zone)', 'plpgsql', 'v', true, 'postgres', array['search_path=pg_catalog, public, pg_temp'], 'b8bb94be6a64572e4dd35d2dfe3fa33e', '06c8bd810f2d9a52a993cd903c13793a', 'false', 'public-rpc'),
  ('family_staff_list_family_conversations()', 'family_staff_list_family_conversations', 'TABLE(conversation_id bigint, gym_id bigint, gym_name text, latest_message_preview text, latest_sender_kind text, latest_message_at timestamp with time zone, unread_count bigint)', 'sql', 's', true, 'postgres', array['search_path=pg_catalog, public, pg_temp'], 'b57e1f1e47b8edef4f9c1ab6898048c4', '06c8bd810f2d9a52a993cd903c13793a', 'false', 'public-rpc'),
  ('family_staff_list_staff_conversations(bigint)', 'family_staff_list_staff_conversations', 'TABLE(conversation_id bigint, gym_id bigint, family_label text, latest_message_preview text, latest_sender_kind text, latest_message_at timestamp with time zone, unread_count bigint, can_reply boolean)', 'plpgsql', 's', true, 'postgres', array['search_path=pg_catalog, public, pg_temp'], '58e6a52c0d42170ebadaf6880768b653', '06c8bd810f2d9a52a993cd903c13793a', 'false', 'public-rpc'),
  ('family_staff_list_message_history(bigint,text,bigint,integer)', 'family_staff_list_message_history', 'TABLE(message_id bigint, sender_kind text, sender_label text, body text, created_at timestamp with time zone, has_more boolean)', 'plpgsql', 's', true, 'postgres', array['search_path=pg_catalog, public, pg_temp'], 'f5a9c4a0b7716568c8b290a0d5be2dd8', '06c8bd810f2d9a52a993cd903c13793a', 'false', 'public-rpc'),
  ('family_staff_open_unread_page(bigint,text,integer)', 'family_staff_open_unread_page', 'TABLE(read_cursor_id uuid, base_read_message_id bigint, through_message_id bigint, has_more boolean, messages jsonb)', 'plpgsql', 'v', true, 'postgres', array['search_path=pg_catalog, public, pg_temp'], '10f87542b7edac2c75671dbd0a484598', '06c8bd810f2d9a52a993cd903c13793a', 'false', 'public-rpc'),
  ('family_staff_acknowledge_read(bigint,text,uuid,bigint)', 'family_staff_acknowledge_read', 'TABLE(last_read_message_id bigint, acknowledged_at timestamp with time zone)', 'plpgsql', 'v', true, 'postgres', array['search_path=pg_catalog, public, pg_temp'], 'ec90c33d3d0085c71bf5956aa392919c', '06c8bd810f2d9a52a993cd903c13793a', 'false', 'public-rpc'),
  ('family_staff_purge_expired_read_cursors(timestamp with time zone)', 'family_staff_purge_expired_read_cursors', 'bigint', 'plpgsql', 'v', true, 'postgres', array['search_path=pg_catalog, public, pg_temp'], 'b84f4d4471862b3991590e9a76df72f7', 'db23e67d6fad77fdfa003856d807d6af', 'false', 'internal');

do $$
declare v_problem text;
begin
  if current_user <> 'postgres' then
    raise exception 'Run this reviewed SECURITY DEFINER migration only as postgres.';
  end if;
  if exists (select 1 from _gz_expected_functions where definition_md5 like '__REPLACE_%__' or acl_md5 like '__REPLACE_%__' or acl_is_default like '__REPLACE_%__') then
    raise exception 'Populate all sixteen approved baseline definition and ACL hashes before deployment.';
  end if;
  if to_regnamespace('grau_messaging_private') is not null then
    raise exception 'Private rollout schema already exists; stop rather than reuse an unknown backup.';
  end if;
  if to_regprocedure('grau_messaging_private.family_staff_gym4_rollout_enabled(bigint)') is not null then
    raise exception 'Private Gym 4 rollout helper already exists.';
  end if;

  select string_agg(e.signature, ', ' order by e.signature) into v_problem
  from _gz_expected_functions e
  left join pg_proc p on p.oid = to_regprocedure('public.' || e.signature)
  left join pg_language l on l.oid = p.prolang
  where p.oid is null
     or p.proname <> e.function_name
     or pg_get_function_result(p.oid) <> e.result_contract
     or l.lanname <> e.language_name
     or p.provolatile <> e.volatility
     or p.prosecdef <> e.security_definer
     or pg_get_userbyid(p.proowner) <> e.owner_name
     or p.proconfig is distinct from e.function_config
     or md5(pg_get_functiondef(p.oid)) <> e.definition_md5
     or md5(coalesce(p.proacl::text, '<DEFAULT_ACL>')) <> e.acl_md5
     or (p.proacl is null)::text <> e.acl_is_default
     or (e.api_contract='public-rpc' and (not has_function_privilege('authenticated',p.oid,'execute') or has_function_privilege('anon',p.oid,'execute') or exists (select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE')))
     or (e.api_contract='internal' and (has_function_privilege('authenticated',p.oid,'execute') or has_function_privilege('anon',p.oid,'execute') or exists (select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE')));
  if v_problem is not null then
    raise exception 'Messaging preflight contract/hash mismatch: %', v_problem;
  end if;

  -- Reject every messaging routine or overload outside the reviewed
  -- sixteen-signature manifest. A later function addition needs its own review
  -- and cannot silently coexist with this narrowly scoped rollout.
  select string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text) into v_problem
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace
    and p.proname like 'family_staff_%'
    and not exists (select 1 from _gz_expected_functions e where p.oid = to_regprocedure('public.' || e.signature));
  if v_problem is not null then
    raise exception 'Unexpected messaging function or overload(s): %', v_problem;
  end if;
end
$$;

-- The backup schema has no API-facing grants. PostgREST cannot access its
-- objects through the public schema, and anon/authenticated/PUBLIC receive no
-- schema or table privileges.
create schema grau_messaging_private authorization postgres;
revoke all on schema grau_messaging_private from public;
revoke all on schema grau_messaging_private from anon, authenticated;

create table grau_messaging_private.family_messaging_rollout_backup (
  migration_key text not null,
  signature text primary key,
  baseline_definition text not null,
  baseline_definition_md5 text not null,
  approved_baseline_definition_md5 text not null,
  baseline_language name not null,
  baseline_volatility "char" not null,
  baseline_security_definer boolean not null,
  baseline_owner oid not null,
  baseline_config text[],
  baseline_result text not null,
  baseline_acl aclitem[],
  baseline_acl_is_default boolean not null,
  post_definition_md5 text,
  post_language name,
  post_volatility "char",
  post_security_definer boolean,
  post_owner oid,
  post_config text[],
  post_result text,
  post_acl aclitem[],
  post_acl_is_default boolean,
  backed_up_at timestamptz not null default now()
);
revoke all on table grau_messaging_private.family_messaging_rollout_backup from public;
revoke all on table grau_messaging_private.family_messaging_rollout_backup from anon, authenticated;

-- This separate metadata row records the expected deployed helper state. It is
-- not a baseline definition: the helper is new and is removed only by a
-- guarded rollback after its deployed hash has been rechecked.
create table grau_messaging_private.family_messaging_rollout_metadata (
  migration_key text primary key,
  helper_signature text not null,
  helper_definition_md5 text not null,
  helper_language name not null,
  helper_volatility "char" not null,
  helper_security_definer boolean not null,
  helper_owner oid not null,
  helper_config text[],
  helper_acl aclitem[],
  helper_acl_is_default boolean not null,
  private_schema_acl aclitem[],
  private_schema_acl_is_default boolean not null,
  recorded_at timestamptz not null default now()
);
revoke all on table grau_messaging_private.family_messaging_rollout_metadata from public;
revoke all on table grau_messaging_private.family_messaging_rollout_metadata from anon, authenticated;

insert into grau_messaging_private.family_messaging_rollout_backup (
  migration_key, signature, baseline_definition, baseline_definition_md5, approved_baseline_definition_md5,
  baseline_language, baseline_volatility, baseline_security_definer,
  baseline_owner, baseline_config, baseline_result, baseline_acl,
  baseline_acl_is_default
)
select 'gym4-rollout-v1', e.signature, pg_get_functiondef(p.oid),
       md5(pg_get_functiondef(p.oid)), e.definition_md5, l.lanname, p.provolatile, p.prosecdef,
       p.proowner, p.proconfig, pg_get_function_result(p.oid), p.proacl,
       p.proacl is null
from _gz_expected_functions e
join pg_proc p on p.oid = to_regprocedure('public.' || e.signature)
join pg_language l on l.oid = p.prolang;

-- The new helper is private and has no callable grant for PUBLIC, anon, or
-- authenticated. Existing SECURITY DEFINER functions call it by qualification
-- under their postgres owner.
create function grau_messaging_private.family_staff_gym4_rollout_enabled(p_gym_id bigint)
returns boolean language sql immutable security definer
set search_path = pg_catalog, pg_temp
as $$ select coalesce(p_gym_id = 4, false) $$;
revoke all on function grau_messaging_private.family_staff_gym4_rollout_enabled(bigint) from public;
revoke all on function grau_messaging_private.family_staff_gym4_rollout_enabled(bigint) from anon, authenticated;

insert into grau_messaging_private.family_messaging_rollout_metadata (
  migration_key, helper_signature, helper_definition_md5, helper_language,
  helper_volatility, helper_security_definer, helper_owner, helper_config,
  helper_acl, helper_acl_is_default, private_schema_acl,
  private_schema_acl_is_default
)
select 'gym4-rollout-v1', 'grau_messaging_private.family_staff_gym4_rollout_enabled(bigint)',
       md5(pg_get_functiondef(p.oid)), l.lanname, p.provolatile, p.prosecdef,
       p.proowner, p.proconfig, p.proacl, p.proacl is null, n.nspacl,
       n.nspacl is null
from pg_proc p
join pg_language l on l.oid=p.prolang
join pg_namespace n on n.oid='grau_messaging_private'::regnamespace
where p.oid='grau_messaging_private.family_staff_gym4_rollout_enabled(bigint)'::regprocedure;

-- Six existing functions are replaced. CREATE OR REPLACE preserves their OID,
-- owner, and ACL. No GRANT or REVOKE is applied to an existing function, so an
-- explicit ACL remains explicit and a NULL/default ACL remains NULL.
create or replace function public.family_staff_is_active_staff(p_gym_id bigint)
returns boolean language sql stable security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select grau_messaging_private.family_staff_gym4_rollout_enabled(p_gym_id)
     and auth.uid() is not null and exists (
       select 1 from public.gym_staff as gs
       where gs.user_id=auth.uid() and gs.gym_id=p_gym_id
         and gs.is_active=true and gs.role in ('admin','coach')
     );
$$;

create or replace function public.family_staff_is_active_admin(p_gym_id bigint)
returns boolean language sql stable security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select grau_messaging_private.family_staff_gym4_rollout_enabled(p_gym_id)
     and auth.uid() is not null and exists (
       select 1 from public.gym_staff as gs
       where gs.user_id=auth.uid() and gs.gym_id=p_gym_id
         and gs.is_active=true and gs.role='admin'
     );
$$;

create or replace function public.family_staff_is_approved_family(p_gym_id bigint)
returns boolean language sql stable security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select grau_messaging_private.family_staff_gym4_rollout_enabled(p_gym_id)
     and auth.uid() is not null and exists (
       select 1 from public.member_account_links as mal
       where mal.user_id=auth.uid() and mal.gym_id=p_gym_id
         and mal.status='approved' and mal.approved_at is not null and mal.revoked_at is null
     );
$$;

create or replace function public.family_staff_require_conversation(p_conversation_id bigint,p_access_role text)
returns public.family_staff_conversations
language plpgsql stable security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare v_conversation public.family_staff_conversations%rowtype;
begin
  if auth.uid() is null then raise exception 'Sign-in is required.' using errcode='42501'; end if;
  if p_conversation_id is null then raise exception 'Conversation ID is required.' using errcode='22023'; end if;
  if p_access_role is null or p_access_role not in ('family','staff') then raise exception 'Access role must be family or staff.' using errcode='22023'; end if;
  select c.* into v_conversation from public.family_staff_conversations c where c.id=p_conversation_id;
  if not found then raise exception 'Conversation was not found.' using errcode='P0002'; end if;
  if not grau_messaging_private.family_staff_gym4_rollout_enabled(v_conversation.gym_id) then
    raise exception 'Messaging is not enabled for this academy.' using errcode='42501';
  end if;
  if p_access_role='staff' and public.family_staff_is_active_staff(v_conversation.gym_id) then return v_conversation; end if;
  if p_access_role='family' and v_conversation.family_user_id=auth.uid() and public.family_staff_is_approved_family(v_conversation.gym_id) then return v_conversation; end if;
  raise exception 'You do not have access to this conversation.' using errcode='42501';
end;
$$;

create or replace function public.family_staff_upsert_staff_profile(p_user_id uuid,p_gym_id bigint,p_display_name text)
returns public.gym_staff_profiles language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare v_profile public.gym_staff_profiles%rowtype; v_name text:=btrim(coalesce(p_display_name,''));
begin
  if p_user_id is null or p_gym_id is null then raise exception 'Staff user and gym IDs are required.' using errcode='22023'; end if;
  if not grau_messaging_private.family_staff_gym4_rollout_enabled(p_gym_id) then raise exception 'Messaging is not enabled for this academy.' using errcode='42501'; end if;
  perform 1 from public.gym_staff gs where gs.user_id=auth.uid() and gs.gym_id=p_gym_id and gs.is_active=true and gs.role='admin' for share;
  if not found then raise exception 'Active academy administrator membership is required.' using errcode='42501'; end if;
  if length(v_name) not between 1 and 120 then raise exception 'Display name must contain 1 to 120 characters.' using errcode='22023'; end if;
  if not exists (select 1 from public.gym_staff gs where gs.user_id=p_user_id and gs.gym_id=p_gym_id) then raise exception 'Staff member was not found for this academy.' using errcode='P0002'; end if;
  insert into public.gym_staff_profiles as sp(user_id,gym_id,display_name,updated_by) values(p_user_id,p_gym_id,v_name,auth.uid())
  on conflict(user_id,gym_id) do update set display_name=excluded.display_name,updated_by=excluded.updated_by,updated_at=now()
  returning * into v_profile;
  return v_profile;
end;
$$;

-- This SQL-to-PL/pgSQL conversion preserves the exact TABLE return contract,
-- select list, ordering, unread-count expression, and empty-result behavior.
create or replace function public.family_staff_list_family_conversations()
returns table(conversation_id bigint,gym_id bigint,gym_name text,latest_message_preview text,latest_sender_kind text,latest_message_at timestamptz,unread_count bigint)
language plpgsql stable security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if not public.family_staff_is_approved_family(4) then
    raise exception 'An approved, non-revoked Gym 4 family link is required.' using errcode='42501';
  end if;
  return query
  select c.id,c.gym_id,gs.gym_name,left(coalesce(latest.body,''),160),latest.sender_kind,latest.created_at,
    (select count(*) from public.family_staff_messages um left join public.family_staff_conversation_reads ur on ur.conversation_id=c.id and ur.user_id=auth.uid() and ur.access_role='family' where um.conversation_id=c.id and um.sender_kind='staff' and (ur.last_read_message_id is null or um.id>ur.last_read_message_id))
  from public.family_staff_conversations c join public.gym_settings gs on gs.id=c.gym_id
  left join lateral (select m.body,m.sender_kind,m.created_at from public.family_staff_messages m where m.conversation_id=c.id order by m.id desc limit 1) latest on true
  where c.family_user_id=auth.uid()
    and grau_messaging_private.family_staff_gym4_rollout_enabled(c.gym_id)
    and public.family_staff_is_approved_family(c.gym_id)
  order by latest.created_at desc nulls last,c.id desc;
end;
$$;

-- New helper must be inaccessible to every API-facing grantee. PUBLIC is a
-- special ACL grantee (OID 0), never a quoted role identifier.
do $$
declare v_bad boolean; v_helper pg_proc%rowtype;
begin
  select p.* into v_helper
  from pg_proc p
  where p.oid='grau_messaging_private.family_staff_gym4_rollout_enabled(bigint)'::regprocedure;
  if not found
     or pg_get_userbyid(v_helper.proowner)<>'postgres'
     or v_helper.provolatile<>'i'
     or not v_helper.prosecdef
     or v_helper.proconfig is distinct from array['search_path=pg_catalog, pg_temp']
     or pg_get_function_result(v_helper.oid)<>'boolean'
     or not has_function_privilege('postgres',v_helper.oid,'execute')
     or has_schema_privilege('anon','grau_messaging_private','usage')
     or has_schema_privilege('authenticated','grau_messaging_private','usage')
     or exists (
       select 1 from pg_namespace n,
         lateral aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a
       where n.oid='grau_messaging_private'::regnamespace
         and a.grantee=0 and a.privilege_type='USAGE'
     ) then
    raise exception 'Private Gym 4 helper/schema contract is invalid.';
  end if;
  select has_function_privilege('anon', p.oid, 'execute')
      or has_function_privilege('authenticated', p.oid, 'execute')
      or exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE')
    into v_bad
  from pg_proc p where p.oid='grau_messaging_private.family_staff_gym4_rollout_enabled(bigint)'::regprocedure;
  if coalesce(v_bad,true) then raise exception 'Gym 4 rollout helper is exposed to an API-facing grantee.'; end if;
end
$$;

-- Preserve exact ACL behavior on all sixteen existing functions. This catches
-- both a changed privilege and a changed NULL/default-versus-explicit ACL.
do $$
declare v_problem text;
begin
  update grau_messaging_private.family_messaging_rollout_backup b
  set post_definition_md5=md5(pg_get_functiondef(p.oid)), post_language=l.lanname,
      post_volatility=p.provolatile, post_security_definer=p.prosecdef,
      post_owner=p.proowner, post_config=p.proconfig,
      post_result=pg_get_function_result(p.oid), post_acl=p.proacl,
      post_acl_is_default=(p.proacl is null)
  from pg_proc p join pg_language l on l.oid=p.prolang
  where b.migration_key='gym4-rollout-v1' and p.oid=to_regprocedure('public.' || b.signature);

  if (select count(*) from grau_messaging_private.family_messaging_rollout_backup where migration_key='gym4-rollout-v1' and post_definition_md5 is not null and post_language is not null and post_volatility is not null and post_security_definer is not null and post_owner is not null and post_result is not null and post_acl_is_default is not null)<>16 then
    raise exception 'Could not record all sixteen expected post-deployment function contracts.';
  end if;

  select string_agg(b.signature, ', ' order by b.signature) into v_problem
  from grau_messaging_private.family_messaging_rollout_backup b
  join pg_proc p on p.oid=to_regprocedure('public.' || b.signature)
  where b.migration_key='gym4-rollout-v1'
    and (p.proowner<>b.baseline_owner or p.proacl is distinct from b.baseline_acl or (p.proacl is null)<>b.baseline_acl_is_default);
  if v_problem is not null then raise exception 'Existing function owner/ACL changed unexpectedly: %', v_problem; end if;
end
$$;

commit;
