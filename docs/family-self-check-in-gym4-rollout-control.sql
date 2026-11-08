-- REVIEW-ONLY DEPLOYMENT MIGRATION — DO NOT EXECUTE WITHOUT EXPLICIT APPROVAL
-- Grau Zero Family Self-Check-In: Gym 4 rollout control and immutable audit.
--
-- This is separate from, and does not edit, family-self-check-in-migration.sql.
-- It creates no rollout row and does not enable self-check-in.
-- Only the postgres database-owner role retains EXECUTE on the private control
-- routine. Browser roles receive no schema, table, sequence, or function access.

begin;

do $$
declare
  v_private_schema oid := to_regnamespace('grau_self_check_in_private');
  v_rollouts regclass := to_regclass('grau_self_check_in_private.gym_rollouts');
  v_gym_settings regclass := to_regclass('public.gym_settings');
  v_rollouts_gym_id_attnum smallint;
  v_gym_settings_id_attnum smallint;
begin
  if v_private_schema is null then
    raise exception 'grau_self_check_in_private is missing; deploy the reviewed base self-check-in foundation first.';
  end if;

  if v_rollouts is null then
    raise exception 'grau_self_check_in_private.gym_rollouts is missing; deploy the reviewed base self-check-in foundation first.';
  end if;

  if v_gym_settings is null then
    raise exception 'public.gym_settings is missing; Gym 4 cannot be verified.';
  end if;

  select attribute.attnum
  into v_rollouts_gym_id_attnum
  from pg_attribute as attribute
  where attribute.attrelid = v_rollouts
    and attribute.attname = 'gym_id'
    and not attribute.attisdropped;

  select attribute.attnum
  into v_gym_settings_id_attnum
  from pg_attribute as attribute
  where attribute.attrelid = v_gym_settings
    and attribute.attname = 'id'
    and not attribute.attisdropped;

  if not exists (select 1 from public.gym_settings where id = 4) then
    raise exception 'Gym 4 must exist before creating a Gym 4-only rollout control.';
  end if;

  if exists (
    select 1
    from (values
      ('gym_id', 'bigint'),
      ('enabled', 'boolean'),
      ('enabled_at', 'timestamp with time zone'),
      ('enabled_by', 'uuid'),
      ('disabled_at', 'timestamp with time zone'),
      ('disabled_by', 'uuid'),
      ('created_at', 'timestamp with time zone'),
      ('updated_at', 'timestamp with time zone')
    ) as expected(column_name, expected_type)
    left join pg_attribute as attribute
      on attribute.attrelid = v_rollouts
     and attribute.attname = expected.column_name
     and not attribute.attisdropped
    where attribute.attnum is null
       or format_type(attribute.atttypid, attribute.atttypmod) <> expected.expected_type
  ) then
    raise exception 'gym_rollouts required columns or types do not match the reviewed base self-check-in contract.';
  end if;

  if not exists (
    select 1
    from pg_constraint as con
    where con.conrelid = v_rollouts
      and con.contype = 'p'
      and con.conkey = array[v_rollouts_gym_id_attnum]::smallint[]
  ) then
    raise exception 'gym_rollouts must have gym_id as its sole primary key.';
  end if;

  if not exists (
    select 1
    from pg_constraint as con
    where con.conrelid = v_rollouts
      and con.contype = 'f'
      and con.confrelid = v_gym_settings
      and con.conkey = array[v_rollouts_gym_id_attnum]::smallint[]
      and con.confkey = array[v_gym_settings_id_attnum]::smallint[]
  ) then
    raise exception 'gym_rollouts must retain its gym_id foreign key to public.gym_settings.';
  end if;

  if not exists (
    select 1
    from pg_constraint as con
    where con.conrelid = v_rollouts
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%enabled_at is not null%'
      and pg_get_constraintdef(con.oid) ilike '%enabled_by is not null%'
  ) then
    raise exception 'gym_rollouts must retain the reviewed enabled-state accountability constraint.';
  end if;

  if not exists (
    select 1
    from pg_class as relation
    where relation.oid = v_rollouts
      and relation.relrowsecurity
  ) then
    raise exception 'gym_rollouts must have RLS enabled before rollout control can be added.';
  end if;

  if exists (
    select 1
    from pg_class as relation
    join pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'grau_self_check_in_private'
      and relation.relname = 'rollout_control_events'
  ) then
    raise exception 'rollout_control_events already exists; stop and inventory it before deployment.';
  end if;

  if to_regprocedure('grau_self_check_in_private.set_gym4_self_check_in_rollout(boolean,uuid,text)') is not null then
    raise exception 'set_gym4_self_check_in_rollout already exists; stop and inventory it before deployment.';
  end if;

  if not exists (
    select 1
    from pg_roles
    where rolname = 'postgres'
      and (rolsuper or rolbypassrls)
  ) then
    raise exception 'The postgres owner role must be superuser or BYPASSRLS so reviewed SECURITY DEFINER control code can access forced-RLS private tables.';
  end if;
end
$$;

create table grau_self_check_in_private.rollout_control_events (
  id bigint generated always as identity primary key,
  gym_id bigint not null default 4 references public.gym_settings(id),
  previous_enabled boolean not null,
  enabled boolean not null,
  actor_user_id uuid not null,
  database_role name not null,
  reason text not null,
  occurred_at timestamptz not null default clock_timestamp(),
  check (gym_id = 4),
  check (btrim(reason) <> '')
);

alter table grau_self_check_in_private.rollout_control_events owner to postgres;
alter table grau_self_check_in_private.rollout_control_events enable row level security;
alter table grau_self_check_in_private.rollout_control_events force row level security;

create function grau_self_check_in_private.rollout_control_events_immutable()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, grau_self_check_in_private, pg_temp
as $$
begin
  raise exception 'Gym 4 rollout control events are immutable.' using errcode = '42501';
end;
$$;

alter function grau_self_check_in_private.rollout_control_events_immutable() owner to postgres;

create trigger rollout_control_events_immutable
before update or delete on grau_self_check_in_private.rollout_control_events
for each row execute function grau_self_check_in_private.rollout_control_events_immutable();

create function grau_self_check_in_private.set_gym4_self_check_in_rollout(
  p_enabled boolean,
  p_actor_user_id uuid,
  p_reason text
)
returns table (
  gym_id bigint,
  enabled boolean,
  changed boolean,
  event_id bigint,
  changed_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public, grau_self_check_in_private, pg_temp
as $$
declare
  v_rollout grau_self_check_in_private.gym_rollouts%rowtype;
  v_previous_enabled boolean;
  v_event_id bigint;
  v_changed_at timestamptz;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  -- This routine is private and receives no grants. session_user identifies
  -- the database login that invoked the function; current_user would be the
  -- SECURITY DEFINER owner and cannot identify that caller.
  if session_user <> 'postgres' then
    raise exception 'Only the trusted database administrator may control Gym 4 self-check-in rollout.' using errcode = '42501';
  end if;

  if p_enabled is null or p_actor_user_id is null or v_reason = '' then
    raise exception 'State, accountable Gym 4 administrator, and reason are required.' using errcode = '22023';
  end if;

  -- This is an accountable Gym 4 administrator reference, not cryptographic
  -- proof of the human database operator. The runbook requires that operator
  -- to be identified separately in the approved change record.
  -- The UUID also supplies the value required by the base gym_rollouts contract.
  if not exists (
    select 1
    from public.gym_staff as staff
    where staff.gym_id = 4
      and staff.user_id = p_actor_user_id
      and staff.is_active = true
      and staff.role = 'admin'
  ) then
    raise exception 'The accountable actor must be an active Gym 4 administrator.' using errcode = '42501';
  end if;

  -- Creates a fail-closed initial row only when one does not yet exist. This
  -- is provisioning, not an audited enable/disable transition: no audit row
  -- or enable/disable metadata is written unless the requested state differs.
  -- The primary key and following FOR UPDATE lock serialize concurrent changes.
  insert into grau_self_check_in_private.gym_rollouts (
    gym_id, enabled
  )
  values (4, false)
  on conflict on constraint gym_rollouts_pkey do nothing;

  select rollout.*
  into v_rollout
  from grau_self_check_in_private.gym_rollouts as rollout
  where rollout.gym_id = 4
  for update;

  v_previous_enabled := v_rollout.enabled;

  if v_previous_enabled is not distinct from p_enabled then
    return query
    select v_rollout.gym_id, v_rollout.enabled, false, null::bigint, v_rollout.updated_at;
    return;
  end if;

  v_changed_at := clock_timestamp();

  if p_enabled then
    update grau_self_check_in_private.gym_rollouts as rollout
    set enabled = true,
        enabled_at = v_changed_at,
        enabled_by = p_actor_user_id,
        updated_at = v_changed_at
    where rollout.gym_id = 4
    returning rollout.* into v_rollout;
  else
    update grau_self_check_in_private.gym_rollouts as rollout
    set enabled = false,
        disabled_at = v_changed_at,
        disabled_by = p_actor_user_id,
        updated_at = v_changed_at
    where rollout.gym_id = 4
    returning rollout.* into v_rollout;
  end if;

  insert into grau_self_check_in_private.rollout_control_events (
    gym_id, previous_enabled, enabled, actor_user_id, database_role, reason, occurred_at
  )
  values (4, v_previous_enabled, p_enabled, p_actor_user_id, session_user, v_reason, v_changed_at)
  returning id into v_event_id;

  return query
  select v_rollout.gym_id, v_rollout.enabled, true, v_event_id, v_changed_at;
end;
$$;

alter function grau_self_check_in_private.set_gym4_self_check_in_rollout(boolean, uuid, text) owner to postgres;

revoke all on table grau_self_check_in_private.rollout_control_events from public, anon, authenticated, service_role;
revoke all on sequence grau_self_check_in_private.rollout_control_events_id_seq from public, anon, authenticated, service_role;
revoke all on function grau_self_check_in_private.rollout_control_events_immutable() from public, anon, authenticated, service_role;
revoke all on function grau_self_check_in_private.set_gym4_self_check_in_rollout(boolean, uuid, text) from public, anon, authenticated, service_role;

commit;
