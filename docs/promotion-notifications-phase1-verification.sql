-- READ ONLY — run only after a successful Phase 1 migration deployment.
-- This script makes no data or schema changes.

select n.nspname as schema_name, n.nspacl::text as schema_acl
from pg_namespace n
where n.nspname = 'grau_promotion_notifications_private';

select c.relname as table_name, c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as rls_forced, c.relacl::text as table_acl
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'grau_promotion_notifications_private' and c.relkind = 'r'
order by c.relname;

select c.relname as table_name, p.polname as policy_name
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_policy p on p.polrelid = c.oid
where n.nspname = 'grau_promotion_notifications_private' and c.relkind = 'r'
order by c.relname, p.polname;

select c.relname as table_name, t.tgname as trigger_name,
  pg_get_triggerdef(t.oid, true) as trigger_definition
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'grau_promotion_notifications_private' and not t.tgisinternal
order by c.relname, t.tgname;

select p.proname, pg_get_function_identity_arguments(p.oid) as identity_arguments,
  p.prosecdef as security_definer, pg_get_userbyid(p.proowner) as owner,
  p.proacl::text as function_acl
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'grau_promotion_notifications_private'
order by p.proname, identity_arguments;

select count(*) as private_table_count
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'grau_promotion_notifications_private' and c.relkind = 'r';

select count(*) as enabled_rollout_count
from grau_promotion_notifications_private.gym_notification_rollouts
where enabled;

select count(*) as notification_event_count
from grau_promotion_notifications_private.notification_events;

select count(*) as outbox_count
from grau_promotion_notifications_private.promotion_notification_outbox;

select count(*) as inbox_count
from grau_promotion_notifications_private.notification_inbox;
