-- READ ONLY. Run this against the connected Supabase project before reviewing
-- docs/waiver-supabase-migration.sql. It makes no schema, policy, storage, or
-- data changes.

begin read only;

-- Existing table shape and relevant constraints.
select
  c.table_schema,
  c.table_name,
  c.column_name,
  c.data_type,
  c.udt_name,
  c.is_nullable,
  c.column_default
from information_schema.columns c
where c.table_schema = 'public'
  and c.table_name in ('students', 'gym_settings', 'gym_staff')
order by c.table_name, c.ordinal_position;

select
  con.conname,
  con.contype,
  pg_get_constraintdef(con.oid) as definition
from pg_constraint con
join pg_namespace n on n.oid = con.connamespace
where n.nspname = 'public'
  and con.conrelid::regclass::text in ('public.students', 'public.gym_settings', 'public.gym_staff')
order by con.conrelid::regclass::text, con.conname;

select
  indexrelid::regclass as index_name,
  pg_get_indexdef(indexrelid) as definition
from pg_index
where indrelid in ('public.students'::regclass, 'public.gym_settings'::regclass, 'public.gym_staff'::regclass)
order by indrelid::regclass::text, indexrelid::regclass::text;

-- Verify the existing legacy waiver field and staff roles actually in use.
select "studentId", gym_id, waiver_signed
from public.students
order by "studentId"
limit 25;

select role, is_active, count(*) as memberships
from public.gym_staff
group by role, is_active
order by role, is_active;

-- Review current RLS and explicit grants before adding private records.
select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where schemaname in ('public', 'storage')
  and tablename in ('students', 'gym_staff', 'waiver_versions', 'member_waiver_submissions', 'objects')
order by schemaname, tablename, policyname;

select table_schema, table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema in ('public', 'storage')
  and table_name in ('students', 'gym_staff', 'waiver_versions', 'member_waiver_submissions', 'objects')
order by table_schema, table_name, grantee, privilege_type;

-- Verify the reserved private bucket name is available and inspect any prior
-- waiver-related objects without exposing file contents.
select id, name, public, file_size_limit, allowed_mime_types
from storage.buckets
where id = 'member-waivers';

select bucket_id, name, owner_id, created_at, updated_at, metadata
from storage.objects
where bucket_id = 'member-waivers'
order by created_at desc
limit 100;

rollback;
