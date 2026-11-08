-- READ ONLY — Promotion Alerts Phase 2 deployment gate.
-- Does not call RPCs or read student, attendance, family, or payment rows.

-- Exact official-promotion RPC contract. Preserve this definition before any
-- body replacement; this repository does not contain the deployed body.
select
  to_regprocedure('public.record_student_promotion(bigint,text,integer,text)')
    is not null as rpc_exists,
  pg_get_userbyid(proc.proowner) as owner,
  proc.prosecdef as security_definer,
  proc.proconfig as configuration,
  proc.proacl::text as raw_acl,
  pg_get_functiondef(proc.oid) as function_definition
from pg_proc proc
where proc.oid = to_regprocedure(
  'public.record_student_promotion(bigint,text,integer,text)'
);

-- Promotion timestamp and Phase 1 outbox contract.
select
  column_name,
  data_type,
  is_nullable,
  column_default
from information_schema.columns
where (table_schema, table_name) in (
  ('public', 'Promotions'),
  ('grau_promotion_notifications_private', 'promotion_notification_outbox'),
  ('grau_promotion_notifications_private', 'gym_notification_rollouts')
)
order by table_schema, table_name, ordinal_position;

select
  relation.relname as table_name,
  constraint_row.conname,
  pg_get_constraintdef(constraint_row.oid, true) as constraint_definition
from pg_constraint constraint_row
join pg_class relation on relation.oid = constraint_row.conrelid
join pg_namespace namespace on namespace.oid = relation.relnamespace
where namespace.nspname = 'grau_promotion_notifications_private'
  and relation.relname in (
    'gym_notification_rollouts',
    'promotion_notification_outbox',
    'promotion_outbox_recipients',
    'notification_events',
    'notification_inbox',
    'staff_milestone_events',
    'advancement_cycles'
  )
order by relation.relname, constraint_row.conname;

select
  relation.relname as table_name,
  relation.relrowsecurity as rls_enabled,
  relation.relforcerowsecurity as rls_forced,
  relation.relacl::text as raw_acl
from pg_class relation
join pg_namespace namespace on namespace.oid = relation.relnamespace
where namespace.nspname = 'grau_promotion_notifications_private'
  and relation.relkind = 'r'
order by relation.relname;

-- Scheduler discovery only; empty output means no accessible scheduler job
-- information, not that a scheduler is unavailable.
select extensionname, extversion
from pg_extension
where extname in ('pg_cron', 'pg_net', 'pgmq')
order by extname;
