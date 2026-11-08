-- READ-ONLY POST-DEPLOYMENT VERIFICATION — DO NOT ACTIVATE ROLLOUT
-- No RPC calls, DML, DDL, or private row identities are returned.

-- The deployment session must be reviewed separately. The control function
-- requires session_user = postgres, while SECURITY DEFINER changes current_user.
select
  session_user as sql_editor_session_user,
  current_user as sql_editor_current_user,
  role.rolsuper as postgres_is_superuser,
  role.rolbypassrls as postgres_has_bypassrls
from pg_roles as role
where role.rolname = 'postgres';

-- Base rollout-table compatibility required by the separate control migration.
-- Existing gym_rollouts requires RLS. FORCE RLS is reported for review but is
-- not a rollout-control precondition; postgres has confirmed BYPASSRLS.
select
  case when relation.oid is null then 'MISSING' else 'PRESENT' end as base_rollout_table_status,
  relation.relrowsecurity as base_rls_enabled,
  relation.relforcerowsecurity as base_force_rls_observed_not_required,
  (relation.relrowsecurity is true) as base_rls_requirement_met,
  exists (
    select 1 from pg_constraint as constraint
    where constraint.conrelid = relation.oid
      and constraint.contype = 'p'
      and constraint.conkey = array[
        (select attribute.attnum from pg_attribute as attribute
         where attribute.attrelid = relation.oid
           and attribute.attname = 'gym_id'
           and not attribute.attisdropped)
      ]::smallint[]
  ) as gym_id_is_primary_key,
  exists (
    select 1 from pg_constraint as constraint
    where constraint.conrelid = relation.oid
      and constraint.contype = 'f'
      and constraint.confrelid = to_regclass('public.gym_settings')
      and constraint.conkey = array[
        (select attribute.attnum from pg_attribute as attribute
         where attribute.attrelid = relation.oid
           and attribute.attname = 'gym_id'
           and not attribute.attisdropped)
      ]::smallint[]
      and constraint.confkey = array[
        (select attribute.attnum from pg_attribute as attribute
         where attribute.attrelid = to_regclass('public.gym_settings')
           and attribute.attname = 'id'
           and not attribute.attisdropped)
      ]::smallint[]
  ) as has_gym_settings_foreign_key,
  exists (
    select 1 from pg_constraint as constraint
    where constraint.conrelid = relation.oid
      and constraint.contype = 'c'
      and pg_get_constraintdef(constraint.oid) ilike '%enabled_at is not null%'
      and pg_get_constraintdef(constraint.oid) ilike '%enabled_by is not null%'
  ) as has_enabled_accountability_constraint
from pg_class as relation
where relation.oid = to_regclass('grau_self_check_in_private.gym_rollouts');

select
  case when to_regclass('grau_self_check_in_private.rollout_control_events') is null then 'MISSING' else 'PRESENT' end as audit_table_status,
  relation.relrowsecurity as audit_rls_enabled,
  relation.relforcerowsecurity as audit_force_rls_enabled,
  (relation.relrowsecurity is true and relation.relforcerowsecurity is true) as audit_rls_and_force_rls_requirement_met,
  pg_get_userbyid(relation.relowner) as owner_name
from (select 1) as expected
left join pg_class as relation
  on relation.oid = to_regclass('grau_self_check_in_private.rollout_control_events');

select
  case when routine.oid is null then 'MISSING' else 'PRESENT' end as routine_status,
  pg_get_userbyid(routine.proowner) as owner_name,
  routine.prosecdef as security_definer,
  array_to_string(routine.proconfig, ', ') as function_configuration,
  pg_get_functiondef(routine.oid) as function_definition
from (select 1) as expected
left join pg_proc as routine
  on routine.oid = to_regprocedure('grau_self_check_in_private.set_gym4_self_check_in_rollout(boolean,uuid,text)');

with roles(role_name) as (values ('anon'), ('authenticated'), ('service_role'))
select
  roles.role_name,
  case
    when pg_role.oid is null then 'ROLE_MISSING'
    when routine.oid is null then 'FUNCTION_MISSING'
    when has_function_privilege(pg_role.oid, routine.oid, 'EXECUTE') then 'GRANTED'
    else 'NOT_GRANTED'
  end as effective_execute,
  case
    when routine.oid is null then null
    when exists (
      select 1
      from aclexplode(coalesce(routine.proacl, acldefault('f', routine.proowner))) as acl
      where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
    ) then 'PUBLIC_GRANTED'
    else 'PUBLIC_NOT_GRANTED'
  end as public_execute
from roles
left join pg_roles as pg_role on pg_role.rolname = roles.role_name
left join pg_proc as routine
  on routine.oid = to_regprocedure('grau_self_check_in_private.set_gym4_self_check_in_rollout(boolean,uuid,text)')
order by roles.role_name;

with roles(role_name) as (values ('anon'), ('authenticated'), ('service_role'))
select
  roles.role_name,
  case
    when pg_role.oid is null then 'ROLE_MISSING'
    when sequence_relation.oid is null then 'SEQUENCE_MISSING'
    when has_sequence_privilege(pg_role.oid, sequence_relation.oid, 'USAGE')
      or has_sequence_privilege(pg_role.oid, sequence_relation.oid, 'SELECT')
      or has_sequence_privilege(pg_role.oid, sequence_relation.oid, 'UPDATE') then 'GRANTED'
    else 'NOT_GRANTED'
  end as effective_identity_sequence_access,
  case
    when sequence_relation.oid is null then null
    when exists (
      select 1
      from aclexplode(coalesce(sequence_relation.relacl, acldefault('S', sequence_relation.relowner))) as acl
      where acl.grantee = 0
        and acl.privilege_type in ('USAGE', 'SELECT', 'UPDATE')
    ) then 'PUBLIC_GRANTED'
    else 'PUBLIC_NOT_GRANTED'
  end as public_identity_sequence_access
from roles
left join pg_roles as pg_role on pg_role.rolname = roles.role_name
left join pg_class as sequence_relation
  on sequence_relation.oid = to_regclass('grau_self_check_in_private.rollout_control_events_id_seq')
order by roles.role_name;

select
  trigger_info.tgname as trigger_name,
  trigger_info.tgenabled as trigger_enabled,
  pg_get_triggerdef(trigger_info.oid, true) as trigger_definition,
  pg_get_functiondef(trigger_function.oid) as trigger_function_definition
from pg_trigger as trigger_info
join pg_proc as trigger_function on trigger_function.oid = trigger_info.tgfoid
where trigger_info.tgrelid = to_regclass('grau_self_check_in_private.rollout_control_events')
  and not trigger_info.tgisinternal
order by trigger_info.tgname;

-- Aggregate only: this verifies disabled/enabled state without returning actor IDs.
-- A disabled row with zero events is initial fail-closed provisioning, not a
-- recorded deactivation transition.
select
  count(*) as gym_4_rollout_row_count,
  case
    when count(*) = 0 then 'NO_ROLLOUT_ROW__DISABLED_FAIL_CLOSED'
    when count(*) = 1 and bool_or(enabled) then 'ENABLED'
    when count(*) = 1 and not bool_or(enabled) then 'DISABLED'
    else 'UNEXPECTED_NON_UNIQUE_GYM_ID'
  end as rollout_status,
  bool_or(enabled_at is not null) as has_activation_metadata,
  bool_or(disabled_at is not null) as has_deactivation_metadata,
  (select count(*) from grau_self_check_in_private.rollout_control_events) as rollout_control_event_count,
  (select count(*) filter (where previous_enabled = false and enabled = true)
   from grau_self_check_in_private.rollout_control_events) as activation_event_count,
  (select count(*) filter (where previous_enabled = true and enabled = false)
   from grau_self_check_in_private.rollout_control_events) as deactivation_event_count
from grau_self_check_in_private.gym_rollouts
where gym_id = 4;
