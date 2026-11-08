-- READ ONLY — run this inventory in Supabase TEST before reviewing or applying
-- docs/family-attendance-access-migration.sql. It changes no data or policies.
--
-- It reports the exact fields and current RLS policies relied on by the proposed
-- family-only RPC. No attendance-table policy is to be broadened for families.

select
  requested.table_name,
  coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'column', column_info.column_name,
          'data_type', column_info.data_type,
          'nullable', column_info.is_nullable
        ) order by column_info.ordinal_position
      )
      from information_schema.columns column_info
      where column_info.table_schema = 'public'
        and column_info.table_name = requested.table_name
    ),
    '[]'::jsonb
  ) as columns,
  coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'policy', policy_info.policyname,
          'command', policy_info.cmd,
          'roles', policy_info.roles,
          'using', policy_info.qual,
          'with_check', policy_info.with_check
        ) order by policy_info.policyname
      )
      from pg_policies policy_info
      where policy_info.schemaname = 'public'
        and policy_info.tablename = requested.table_name
    ),
    '[]'::jsonb
  ) as policies,
  coalesce(
    (
      select class_info.relrowsecurity
      from pg_class class_info
      join pg_namespace namespace_info on namespace_info.oid = class_info.relnamespace
      where namespace_info.nspname = 'public'
        and class_info.relname = requested.table_name
    ),
    false
  ) as rls_enabled
from (
  values ('attendance'::text), ('classes'::text), ('member_account_links'::text), ('gym_staff'::text)
) as requested(table_name)
order by requested.table_name;
