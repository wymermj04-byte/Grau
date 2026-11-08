-- REVIEW ONLY — DO NOT DEPLOY OR INVOKE WITHOUT SEPARATE APPROVAL.
--
-- Gym 4-only, fail-closed rollout control for Promotion Notifications.
-- This migration creates no rollout row and cannot activate anything unless a
-- trusted database administrator later invokes the control function.
-- Each activation deliberately establishes a fresh generation floor. This
-- excludes both historical promotions and promotions recorded while disabled.

begin;

do $$
declare
  rollout_relation oid;
begin
  if session_user <> 'postgres' then
    raise exception 'Promotion-notification rollout control must be deployed from the trusted postgres database session.';
  end if;

  if not exists (
    select 1 from pg_roles where rolname = 'postgres' and rolbypassrls
  ) then
    raise exception 'The trusted postgres definer must have BYPASSRLS because private notification tables use FORCE ROW LEVEL SECURITY.';
  end if;

  rollout_relation := to_regclass('grau_promotion_notifications_private.gym_notification_rollouts');
  if rollout_relation is null
    or to_regprocedure('grau_promotion_notifications_private.reject_immutable_mutation()') is null then
    raise exception 'The deployed Phase 1 notification foundation is missing.';
  end if;

  if exists (
    select 1
    from (values
      ('gym_id', 'bigint'),
      ('enabled', 'boolean'),
      ('activated_at', 'timestamp with time zone'),
      ('activated_by', 'uuid'),
      ('generation_floor_at', 'timestamp with time zone'),
      ('disabled_at', 'timestamp with time zone'),
      ('disabled_by', 'uuid'),
      ('created_at', 'timestamp with time zone'),
      ('updated_at', 'timestamp with time zone')
    ) as expected(column_name, expected_type)
    left join pg_attribute as attribute
      on attribute.attrelid = rollout_relation
      and attribute.attname = expected.column_name
      and attribute.attnum > 0
      and not attribute.attisdropped
    where attribute.attnum is null
      or format_type(attribute.atttypid, attribute.atttypmod) <> expected.expected_type
  ) then
    raise exception 'gym_notification_rollouts required columns or types do not match the reviewed Phase 1 contract.';
  end if;

  if not exists (
    select 1
    from pg_constraint as con
    where con.conrelid = rollout_relation
      and con.contype = 'p'
      and pg_get_constraintdef(con.oid, true) = 'PRIMARY KEY (gym_id)'
  ) then
    raise exception 'gym_notification_rollouts must have gym_id as its primary key.';
  end if;

  if not exists (
    select 1 from pg_class as relation
    where relation.oid = rollout_relation
      and relation.relrowsecurity
      and relation.relforcerowsecurity
      and pg_get_userbyid(relation.relowner) = 'postgres'
  ) then
    raise exception 'gym_notification_rollouts must be postgres-owned with RLS and FORCE RLS enabled.';
  end if;

  if exists (
    select 1
    from pg_trigger as trigger_row
    where trigger_row.tgrelid = rollout_relation
      and not trigger_row.tgisinternal
      and trigger_row.tgenabled <> 'D'
  ) then
    raise exception 'gym_notification_rollouts has an unexpected enabled trigger; review its compatibility before deployment.';
  end if;

  if to_regclass('grau_promotion_notifications_private.gym_notification_rollout_control_events') is not null
    or to_regprocedure('grau_promotion_notifications_private.set_gym4_promotion_notification_rollout(boolean,uuid,text,uuid)') is not null then
    raise exception 'Promotion-notification rollout-control objects already exist; stop and inventory the partial deployment.';
  end if;
end
$$;

create table grau_promotion_notifications_private.gym_notification_rollout_control_events (
  id bigint generated always as identity primary key,
  gym_id bigint not null references public.gym_settings(id) on delete restrict,
  request_id uuid not null,
  action text not null check (action in ('provision_disabled', 'activate', 'deactivate', 'noop')),
  requested_enabled boolean not null,
  previous_enabled boolean,
  resulting_enabled boolean not null,
  resulting_generation_floor_at timestamptz,
  actor_user_id uuid not null,
  reason text not null check (length(btrim(reason)) > 0),
  database_session_user text not null,
  database_current_user text not null,
  occurred_at timestamptz not null default clock_timestamp(),
  constraint gym_notification_rollout_control_events_gym4_only check (gym_id = 4),
  constraint gym_notification_rollout_control_events_request_key unique (gym_id, request_id)
);

alter table grau_promotion_notifications_private.gym_notification_rollout_control_events enable row level security;
alter table grau_promotion_notifications_private.gym_notification_rollout_control_events force row level security;
create trigger gym_notification_rollout_control_events_immutable
before update or delete on grau_promotion_notifications_private.gym_notification_rollout_control_events
for each row execute function grau_promotion_notifications_private.reject_immutable_mutation();

create function grau_promotion_notifications_private.set_gym4_promotion_notification_rollout(
  p_enabled boolean,
  p_actor_user_id uuid,
  p_reason text,
  p_request_id uuid
)
returns table (
  result_gym_id bigint,
  result_action text,
  result_enabled boolean,
  result_previous_enabled boolean,
  result_generation_floor_at timestamptz,
  current_enabled boolean,
  current_generation_floor_at timestamptz,
  request_matches_current_state boolean
)
language plpgsql
security definer
set search_path = pg_catalog, public, grau_promotion_notifications_private, pg_temp
as $$
declare
  rollout grau_promotion_notifications_private.gym_notification_rollouts%rowtype;
  event grau_promotion_notifications_private.gym_notification_rollout_control_events%rowtype;
  row_existed boolean;
  prior_enabled boolean;
  action_name text;
  transition_at timestamptz;
  normalized_reason text;
begin
  if session_user <> 'postgres' then
    raise exception 'Only the trusted postgres database session may control promotion-notification rollout.' using errcode = '42501';
  end if;
  normalized_reason := btrim(coalesce(p_reason, ''));
  if p_enabled is null or p_actor_user_id is null or p_request_id is null or length(normalized_reason) = 0 then
    raise exception 'enabled, accountable actor reference, non-empty reason, and request ID are required.' using errcode = '22023';
  end if;
  -- p_actor_user_id identifies the accountable administrator in the audit trail;
  -- session_user = postgres is the actual database-executor authorization gate.

  -- This stable lock serializes first provisioning and all state transitions.
  perform pg_advisory_xact_lock(40917, 4);

  select * into event
  from grau_promotion_notifications_private.gym_notification_rollout_control_events as existing_event
  where existing_event.gym_id = 4 and existing_event.request_id = p_request_id;
  if found then
    if event.requested_enabled is distinct from p_enabled
      or event.actor_user_id is distinct from p_actor_user_id
      or event.reason is distinct from normalized_reason then
      raise exception 'Request ID was already used with different rollout parameters.' using errcode = '22023';
    end if;
    select * into rollout
    from grau_promotion_notifications_private.gym_notification_rollouts as current_rollout
    where current_rollout.gym_id = 4
    for share;
    if not found then
      raise exception 'The audited rollout request has no current Gym 4 rollout row.' using errcode = '23514';
    end if;
    -- Return the immutable original request outcome and the separately named
    -- current state. A retry after later transitions never mislabels its old
    -- operation as the state that exists now.
    return query select
      4::bigint,
      event.action,
      event.resulting_enabled,
      event.previous_enabled,
      event.resulting_generation_floor_at,
      rollout.enabled,
      rollout.generation_floor_at,
      rollout.enabled is not distinct from event.resulting_enabled
        and rollout.generation_floor_at is not distinct from event.resulting_generation_floor_at;
    return;
  end if;

  select exists (
    select 1 from grau_promotion_notifications_private.gym_notification_rollouts as current_rollout
    where current_rollout.gym_id = 4
  ) into row_existed;

  insert into grau_promotion_notifications_private.gym_notification_rollouts (gym_id, enabled)
  values (4, false)
  on conflict on constraint gym_notification_rollouts_pkey do nothing;

  select * into rollout
  from grau_promotion_notifications_private.gym_notification_rollouts as current_rollout
  where current_rollout.gym_id = 4
  for update;

  prior_enabled := case when row_existed then rollout.enabled else null end;
  if p_enabled and not rollout.enabled then
    transition_at := clock_timestamp();
    -- Fresh on every activation by policy: promotions created before this
    -- activation, including during a disabled interval, cannot be enqueued.
    update grau_promotion_notifications_private.gym_notification_rollouts as current_rollout
    set enabled = true,
        activated_at = transition_at,
        activated_by = p_actor_user_id,
        generation_floor_at = transition_at,
        disabled_at = null,
        disabled_by = null,
        updated_at = clock_timestamp()
    where current_rollout.gym_id = 4
    returning * into rollout;
    action_name := 'activate';
  elsif not p_enabled and rollout.enabled then
    transition_at := clock_timestamp();
    update grau_promotion_notifications_private.gym_notification_rollouts as current_rollout
    set enabled = false,
        disabled_at = transition_at,
        disabled_by = p_actor_user_id,
        updated_at = clock_timestamp()
    where current_rollout.gym_id = 4
    returning * into rollout;
    action_name := 'deactivate';
  elsif not row_existed then
    action_name := 'provision_disabled';
  else
    action_name := 'noop';
  end if;

  insert into grau_promotion_notifications_private.gym_notification_rollout_control_events (
    gym_id, request_id, action, requested_enabled, previous_enabled, resulting_enabled,
    resulting_generation_floor_at, actor_user_id, reason, database_session_user, database_current_user
  ) values (
    4, p_request_id, action_name, p_enabled, prior_enabled, rollout.enabled,
    rollout.generation_floor_at, p_actor_user_id, normalized_reason, session_user, current_user
  );

  return query select
    4::bigint,
    action_name,
    rollout.enabled,
    prior_enabled,
    rollout.generation_floor_at,
    rollout.enabled,
    rollout.generation_floor_at,
    true;
end;
$$;

alter function grau_promotion_notifications_private.set_gym4_promotion_notification_rollout(boolean, uuid, text, uuid) owner to postgres;
revoke all on table grau_promotion_notifications_private.gym_notification_rollout_control_events from public, anon, authenticated, service_role;
revoke all on sequence grau_promotion_notifications_private.gym_notification_rollout_control_events_id_seq from public, anon, authenticated, service_role;
revoke all on function grau_promotion_notifications_private.set_gym4_promotion_notification_rollout(boolean, uuid, text, uuid) from public, anon, authenticated, service_role;

commit;
