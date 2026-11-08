-- READ ONLY — Grau Zero Promotion Notifications Phase 2 Main readiness.
-- This script does not invoke an RPC, alter a rollout, or read personal data.

-- Permanent official-promotion integration: ownership, SECURITY DEFINER shape,
-- effective ACLs, and only the approved enqueue/timestamp integration markers.
select
  pg_get_userbyid(proc.proowner) as owner,
  proc.prosecdef as security_definer,
  proc.proconfig as configuration,
  proc.proacl::text as raw_acl,
  position('enqueue_verified_promotion_celebration' in pg_get_functiondef(proc.oid)) > 0
    as uses_official_enqueue_helper,
  position('promotion_effective_at' in pg_get_functiondef(proc.oid)) > 0
    as reads_database_recorded_promotion_timestamp,
  has_function_privilege('anon', proc.oid, 'execute') as anon_can_execute,
  has_function_privilege('authenticated', proc.oid, 'execute') as authenticated_can_execute,
  has_function_privilege('service_role', proc.oid, 'execute') as service_role_can_execute
from pg_proc as proc
where proc.oid = to_regprocedure(
  'public.record_student_promotion(bigint,text,integer,text)'
);

-- The eight installed Phase 2 routines and effective EXECUTE privileges.
-- A NULL oid indicates a missing routine; true where it should be false is an
-- unexpected effective grant, including a grant inherited through PUBLIC.
with expected_functions(label, routine) as (
  values
    ('private enqueue helper', 'grau_promotion_notifications_private.enqueue_verified_promotion_celebration(bigint,bigint,bigint,timestamp with time zone)'),
    ('private rollout guard', 'grau_promotion_notifications_private.require_gym4_notification_rollout()'),
    ('private staff guard', 'grau_promotion_notifications_private.require_gym4_notification_staff()'),
    ('trusted worker', 'public.process_gym4_promotion_notification_outbox(integer)'),
    ('family inbox', 'public.family_promotion_notification_inbox(integer)'),
    ('family mark read', 'public.mark_family_promotion_notification_read(bigint)'),
    ('staff inbox', 'public.staff_promotion_notification_inbox(integer)'),
    ('staff mark read', 'public.mark_staff_promotion_notification_read(bigint)')
)
select
  expected.label,
  expected.routine as expected_signature,
  proc.oid::regprocedure::text as installed_signature,
  pg_get_userbyid(proc.proowner) as owner,
  proc.prosecdef as security_definer,
  proc.proconfig as configuration,
  proc.proacl::text as raw_acl,
  has_function_privilege('anon', proc.oid, 'execute') as anon_can_execute,
  has_function_privilege('authenticated', proc.oid, 'execute') as authenticated_can_execute,
  has_function_privilege('service_role', proc.oid, 'execute') as service_role_can_execute
from expected_functions as expected
left join pg_proc as proc on proc.oid = to_regprocedure(expected.routine)
order by expected.label;

-- Audited Gym 4 rollout-controller installation and its exact callable
-- signature. This remains catalog-only so it is safe even if not installed.
select
  to_regclass('grau_promotion_notifications_private.gym_notification_rollout_control_events')
    is not null as audit_table_exists,
  relation.relrowsecurity as audit_rls_enabled,
  relation.relforcerowsecurity as audit_force_rls_enabled,
  pg_get_userbyid(relation.relowner) as audit_table_owner,
  proc.oid::regprocedure::text as installed_signature,
  pg_get_function_identity_arguments(proc.oid) as identity_arguments,
  pg_get_userbyid(proc.proowner) as function_owner,
  proc.prosecdef as security_definer,
  proc.proconfig as configuration,
  proc.proacl::text as raw_acl,
  has_function_privilege('anon', proc.oid, 'execute') as anon_can_execute,
  has_function_privilege('authenticated', proc.oid, 'execute') as authenticated_can_execute,
  has_function_privilege('service_role', proc.oid, 'execute') as service_role_can_execute
from (select 1) as singleton
left join pg_class as relation
  on relation.oid = to_regclass(
    'grau_promotion_notifications_private.gym_notification_rollout_control_events'
  )
left join pg_proc as proc
  on proc.oid = to_regprocedure(
    'grau_promotion_notifications_private.set_gym4_promotion_notification_rollout(boolean,uuid,text,uuid)'
  );

-- Current rollout state. Zero rows and zero enabled rows are the expected
-- disabled-before-activation baseline.
select
  count(*) filter (where rollout.gym_id = 4) as gym4_rollout_rows,
  count(*) filter (where rollout.gym_id = 4 and rollout.enabled) as gym4_enabled_rows,
  max(rollout.generation_floor_at) filter (where rollout.gym_id = 4)
    as gym4_generation_floor_at,
  max(rollout.activated_at) filter (where rollout.gym_id = 4)
    as gym4_last_activated_at,
  max(rollout.disabled_at) filter (where rollout.gym_id = 4)
    as gym4_last_disabled_at
from grau_promotion_notifications_private.gym_notification_rollouts as rollout;

-- Aggregate notification state only: no student, recipient, family-link, or
-- promotion identifiers are returned.
select
  (select count(*) from grau_promotion_notifications_private.promotion_notification_outbox where gym_id = 4) as gym4_outbox_rows,
  (select count(*) from grau_promotion_notifications_private.promotion_outbox_recipients where gym_id = 4) as gym4_recipient_rows,
  (select count(*) from grau_promotion_notifications_private.notification_events where gym_id = 4) as gym4_event_rows,
  (select count(*) from grau_promotion_notifications_private.notification_inbox where gym_id = 4) as gym4_inbox_rows,
  (select count(*) from grau_promotion_notifications_private.promotion_notification_outbox where gym_id = 4 and state = 'pending') as gym4_pending_outbox_rows,
  (select count(*) from grau_promotion_notifications_private.promotion_notification_outbox where gym_id = 4 and state = 'retry_scheduled') as gym4_retry_scheduled_outbox_rows,
  (select count(*) from grau_promotion_notifications_private.promotion_notification_outbox where gym_id = 4 and state = 'processing') as gym4_processing_outbox_rows,
  (select count(*) from grau_promotion_notifications_private.promotion_notification_outbox where gym_id = 4 and state = 'dead_letter') as gym4_dead_letter_outbox_rows;

-- Remaining database dependencies. Every required object should report true;
-- pg_cron, pg_net, and pgmq are reported only as availability facts, not as
-- installation requests.
select
  to_regprocedure('gen_random_uuid()') is not null as gen_random_uuid_available,
  to_regclass('public.member_account_links') is not null as family_links_table_exists,
  to_regclass('public.gym_staff') is not null as gym_staff_table_exists,
  to_regclass('public."Promotions"') is not null as promotions_table_exists,
  to_regprocedure('grau_promotion_notifications_private.reject_immutable_mutation()') is not null as immutable_guard_exists,
  to_regprocedure('grau_promotion_notifications_private.guard_outbox_mutation()') is not null as outbox_guard_exists,
  exists (select 1 from pg_roles where rolname = 'postgres' and rolbypassrls) as postgres_bypassrls,
  exists (select 1 from pg_roles where rolname = 'service_role') as service_role_exists,
  exists (select 1 from pg_extension where extname = 'pg_cron') as pg_cron_installed,
  exists (select 1 from pg_extension where extname = 'pg_net') as pg_net_installed,
  exists (select 1 from pg_extension where extname = 'pgmq') as pgmq_installed;
