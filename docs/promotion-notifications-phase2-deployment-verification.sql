-- READ ONLY — Phase 2 post-deployment verification.
-- No RPC invocation, rollout activation, or application-data read occurs here.

-- Expected Phase 2 routines, their owners, SECURITY DEFINER settings, fixed
-- search paths, and raw ACLs. Missing rows mean the routine is absent.
select
  namespace.nspname as schema_name,
  proc.proname as function_name,
  pg_get_function_identity_arguments(proc.oid) as identity_arguments,
  pg_get_userbyid(proc.proowner) as owner,
  proc.prosecdef as security_definer,
  proc.proconfig as configuration,
  proc.proacl::text as raw_acl
from pg_proc as proc
join pg_namespace as namespace on namespace.oid = proc.pronamespace
where (namespace.nspname, proc.proname) in (
  ('grau_promotion_notifications_private', 'enqueue_verified_promotion_celebration'),
  ('grau_promotion_notifications_private', 'require_gym4_notification_rollout'),
  ('grau_promotion_notifications_private', 'require_gym4_notification_staff'),
  ('grau_promotion_notifications_private', 'set_gym4_promotion_notification_rollout'),
  ('public', 'process_gym4_promotion_notification_outbox'),
  ('public', 'family_promotion_notification_inbox'),
  ('public', 'mark_family_promotion_notification_read'),
  ('public', 'staff_promotion_notification_inbox'),
  ('public', 'mark_staff_promotion_notification_read')
)
order by schema_name, function_name, identity_arguments;

select
  to_regclass('grau_promotion_notifications_private.gym_notification_rollout_control_events')
    is not null as rollout_audit_table_exists,
  count(*) filter (where event.gym_id = 4) as gym4_audit_events,
  count(*) filter (where event.action = 'activate') as activation_events,
  count(*) filter (where event.action = 'deactivate') as deactivation_events
from grau_promotion_notifications_private.gym_notification_rollout_control_events as event;

-- Promotion RPC contract after integration. Inspect the definition manually:
-- it must retain all original checks and contain only the approved enqueue delta.
select
  pg_get_userbyid(proc.proowner) as owner,
  proc.prosecdef as security_definer,
  proc.proconfig as configuration,
  proc.proacl::text as raw_acl,
  pg_get_functiondef(proc.oid) as function_definition
from pg_proc as proc
where proc.oid = to_regprocedure(
  'public.record_student_promotion(bigint,text,integer,text)'
);

-- The official promotion integration must retain its existing security shape
-- and reference only the reviewed private enqueue helper. This reads metadata
-- only; inspect the returned definition before any activation.
select
  proc.prosecdef as security_definer,
  proc.proconfig as configuration,
  position(
    'enqueue_verified_promotion_celebration'
    in pg_get_functiondef(proc.oid)
  ) > 0 as uses_official_enqueue_helper,
  position(
    'returning id into created_promotion_id'
    in lower(pg_get_functiondef(proc.oid))
  ) > 0 as captures_inserted_promotion_id,
  position(
    'promotion_effective_at'
    in pg_get_functiondef(proc.oid)
  ) > 0 as reads_database_promotion_timestamp
from pg_proc as proc
where proc.oid = to_regprocedure(
  'public.record_student_promotion(bigint,text,integer,text)'
);

-- Explicit executable privilege checks. Expected: private helpers false for
-- browser and service roles; worker true only for service_role; family/staff
-- inbox functions true only for authenticated.
select
  has_function_privilege('anon', 'grau_promotion_notifications_private.enqueue_verified_promotion_celebration(bigint,bigint,bigint,timestamp with time zone)', 'execute') as anon_can_enqueue,
  has_function_privilege('authenticated', 'grau_promotion_notifications_private.enqueue_verified_promotion_celebration(bigint,bigint,bigint,timestamp with time zone)', 'execute') as authenticated_can_enqueue,
  has_function_privilege('service_role', 'grau_promotion_notifications_private.enqueue_verified_promotion_celebration(bigint,bigint,bigint,timestamp with time zone)', 'execute') as service_can_enqueue,
  has_function_privilege('anon', 'public.process_gym4_promotion_notification_outbox(integer)', 'execute') as anon_can_run_worker,
  has_function_privilege('authenticated', 'public.process_gym4_promotion_notification_outbox(integer)', 'execute') as authenticated_can_run_worker,
  has_function_privilege('service_role', 'public.process_gym4_promotion_notification_outbox(integer)', 'execute') as service_can_run_worker,
  has_function_privilege('anon', 'public.family_promotion_notification_inbox(integer)', 'execute') as anon_can_read_family_inbox,
  has_function_privilege('authenticated', 'public.family_promotion_notification_inbox(integer)', 'execute') as authenticated_can_read_family_inbox,
  has_function_privilege('service_role', 'public.family_promotion_notification_inbox(integer)', 'execute') as service_can_read_family_inbox,
  has_function_privilege('anon', 'public.staff_promotion_notification_inbox(integer)', 'execute') as anon_can_read_staff_inbox,
  has_function_privilege('authenticated', 'public.staff_promotion_notification_inbox(integer)', 'execute') as authenticated_can_read_staff_inbox,
  has_function_privilege('service_role', 'public.staff_promotion_notification_inbox(integer)', 'execute') as service_can_read_staff_inbox;

-- The deployment must not create or enable a Gym 4 rollout.
select
  count(*) filter (where rollout.gym_id = 4) as gym4_rollout_rows,
  count(*) filter (where rollout.gym_id = 4 and rollout.enabled) as gym4_enabled_rows,
  count(*) filter (where rollout.gym_id <> 4 and rollout.enabled) as other_enabled_rows
from grau_promotion_notifications_private.gym_notification_rollouts as rollout;

-- Only aggregate Phase 2 state; no family, student, or promotion identities.
select
  outbox.state,
  count(*) as rows
from grau_promotion_notifications_private.promotion_notification_outbox as outbox
group by outbox.state
order by outbox.state;

select
  (select count(*) from grau_promotion_notifications_private.promotion_notification_outbox where gym_id = 4) as gym4_outbox_rows,
  (select count(*) from grau_promotion_notifications_private.notification_events where gym_id = 4) as gym4_notification_events,
  (select count(*) from grau_promotion_notifications_private.notification_inbox where gym_id = 4) as gym4_notification_inbox_rows,
  (select count(*) from grau_promotion_notifications_private.promotion_outbox_recipients where gym_id = 4) as gym4_recipient_snapshots;
