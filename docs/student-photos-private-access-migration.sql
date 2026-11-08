-- REVIEW ONLY — DO NOT APPLY UNTIL THE DEPLOYMENT BLOCKERS BELOW ARE CLOSED.
--
-- This migration does not create, update, move, or delete photo objects and it
-- never changes public.students.photo_url. It reuses the existing private
-- student-photos bucket and changes only its student-photo Storage policies.
--
-- Expected object-key contract (five folders plus a JPEG filename):
--   gym/{gym_id}/students/{student_id}/photos/{filename}.jpg
--
-- The preflight intentionally aborts if any of the six existing objects does
-- not follow that contract, if the bucket is not already private, or if its
-- existing JPEG-only MIME configuration differs. Nothing is changed on abort.

begin;

do $$
declare
  v_bucket_is_public boolean;
  v_allowed_mime_types text[];
  v_object_count integer;
  v_photo_url_count integer;
  v_unrecognized_policy_names text[];
begin
  if to_regclass('public.students') is null
    or to_regclass('public.member_account_links') is null
    or to_regclass('public.gym_staff') is null then
    raise exception 'Student-photo access requires students, member_account_links, and gym_staff.';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'member_account_links'
      and column_name in ('user_id', 'student_id', 'gym_id', 'status', 'approved_at', 'revoked_at')
    group by table_schema, table_name
    having count(*) = 6
  ) then
    raise exception 'member_account_links must expose user_id, student_id, gym_id, status, approved_at, and revoked_at.';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'students'
      and column_name in ('studentId', 'gym_id', 'photo_url')
    group by table_schema, table_name
    having count(*) = 3
  ) then
    raise exception 'students must expose studentId, gym_id, and photo_url.';
  end if;

  select bucket.public, bucket.allowed_mime_types
  into v_bucket_is_public, v_allowed_mime_types
  from storage.buckets bucket
  where bucket.id = 'student-photos';

  if not found then
    raise exception 'The existing student-photos bucket is required; this migration never creates a replacement bucket.';
  end if;

  if v_bucket_is_public is distinct from false then
    raise exception 'student-photos must already be private before this policy migration. Do not switch a public bucket until the app can issue fresh signed URLs.';
  end if;

  if v_allowed_mime_types is distinct from array['image/jpeg']::text[] then
    raise exception 'student-photos must retain its existing JPEG-only allowed_mime_types configuration. This migration does not add PNG or WebP support.';
  end if;

  select count(*) into v_object_count
  from storage.objects object
  where object.bucket_id = 'student-photos';

  if v_object_count <> 6 then
    raise exception 'Expected exactly six existing student-photo objects; found %.', v_object_count;
  end if;

  select count(*) into v_photo_url_count
  from public.students student
  where student.photo_url is not null;

  if v_photo_url_count <> 6 then
    raise exception 'Expected exactly six existing students.photo_url values; found %.', v_photo_url_count;
  end if;

  if exists (
    select 1
    from storage.objects object
    where object.bucket_id = 'student-photos'
      and (
        coalesce(array_length(storage.foldername(object.name), 1), 0) <> 5
        or (storage.foldername(object.name))[1] <> 'gym'
        or (storage.foldername(object.name))[2] !~ '^[0-9]+$'
        or (storage.foldername(object.name))[3] <> 'students'
        or (storage.foldername(object.name))[4] !~ '^[0-9]+$'
        or (storage.foldername(object.name))[5] <> 'photos'
        or coalesce(array_length(string_to_array(object.name, '/'), 1), 0) <> 6
        or split_part(object.name, '/', 6) = ''
        or lower(split_part(object.name, '/', 6)) !~ '\.(jpg|jpeg)$'
      )
  ) then
    raise exception 'Every existing student-photo object must use gym/{gym_id}/students/{student_id}/photos/{filename}.jpg.';
  end if;

  -- No unknown policy mentioning this bucket may remain, because a permissive
  -- legacy policy would bypass the corrected authorization helpers below.
  select array_agg(policy.polname order by policy.polname)
  into v_unrecognized_policy_names
  from pg_policy policy
  where policy.polrelid = 'storage.objects'::regclass
    and (
      coalesce(pg_get_expr(policy.polqual, policy.polrelid), '') like '%student-photos%'
      or coalesce(pg_get_expr(policy.polwithcheck, policy.polrelid), '') like '%student-photos%'
    )
    and policy.polname not in (
      'student_photos_read_authorized',
      'student_photos_insert_active_staff',
      'student_photos_update_active_staff',
      'student_photos_delete_active_staff'
    );

  if v_unrecognized_policy_names is not null then
    raise exception 'Review or remove unrecognized student-photos policies before applying this migration: %', array_to_string(v_unrecognized_policy_names, ', ');
  end if;
end
$$;

-- `private` must remain absent from Supabase's exposed PostgREST schemas. The
-- functions below are callable only while evaluating Storage RLS policies; no
-- public-schema RPC wrapper is created.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

create or replace function private.student_photo_read_allowed(p_object_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_path text[];
  v_gym_id bigint;
  v_student_id bigint;
begin
  if auth.uid() is null then
    return false;
  end if;

  v_path := storage.foldername(p_object_name);
  if coalesce(array_length(v_path, 1), 0) <> 5
    or v_path[1] <> 'gym'
    or v_path[2] !~ '^[0-9]+$'
    or v_path[3] <> 'students'
    or v_path[4] !~ '^[0-9]+$'
    or v_path[5] <> 'photos'
    or coalesce(array_length(string_to_array(p_object_name, '/'), 1), 0) <> 6
    or split_part(p_object_name, '/', 6) = '' then
    return false;
  end if;

  v_gym_id := v_path[2]::bigint;
  v_student_id := v_path[4]::bigint;

  return exists (
    select 1
    from public.gym_staff staff
    join public.students student
      on student."studentId" = v_student_id
     and student.gym_id = v_gym_id
    where staff.user_id = auth.uid()
      and staff.gym_id = v_gym_id
      and staff.is_active = true
  ) or exists (
    select 1
    from public.member_account_links link
    join public.students student
      on student."studentId" = link.student_id
     and student.gym_id = link.gym_id
    where link.user_id = auth.uid()
      and link.status = 'approved'
      and link.approved_at is not null
      and link.revoked_at is null
      and link.student_id = v_student_id
      and link.gym_id = v_gym_id
  );
end;
$$;

create or replace function private.student_photo_write_allowed(p_object_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_path text[];
  v_gym_id bigint;
  v_student_id bigint;
begin
  if auth.uid() is null then
    return false;
  end if;

  v_path := storage.foldername(p_object_name);
  if coalesce(array_length(v_path, 1), 0) <> 5
    or v_path[1] <> 'gym'
    or v_path[2] !~ '^[0-9]+$'
    or v_path[3] <> 'students'
    or v_path[4] !~ '^[0-9]+$'
    or v_path[5] <> 'photos'
    or coalesce(array_length(string_to_array(p_object_name, '/'), 1), 0) <> 6
    or split_part(p_object_name, '/', 6) = '' then
    return false;
  end if;

  v_gym_id := v_path[2]::bigint;
  v_student_id := v_path[4]::bigint;

  return exists (
    select 1
    from public.gym_staff staff
    join public.students student
      on student."studentId" = v_student_id
     and student.gym_id = v_gym_id
    where staff.user_id = auth.uid()
      and staff.gym_id = v_gym_id
      and staff.is_active = true
  );
end;
$$;

-- Functions receive no default public execution. Authenticated gets exactly
-- the schema usage and function execution required for Storage policy
-- evaluation. Because `private` is not an exposed PostgREST schema, this does
-- not create callable public RPC endpoints.
revoke all on function private.student_photo_read_allowed(text) from public, anon, authenticated;
revoke all on function private.student_photo_write_allowed(text) from public, anon, authenticated;
grant execute on function private.student_photo_read_allowed(text) to authenticated;
grant execute on function private.student_photo_write_allowed(text) to authenticated;

drop policy if exists student_photos_read_authorized on storage.objects;
drop policy if exists student_photos_insert_active_staff on storage.objects;
drop policy if exists student_photos_update_active_staff on storage.objects;
drop policy if exists student_photos_delete_active_staff on storage.objects;

create policy student_photos_read_authorized
on storage.objects for select to authenticated
using (
  bucket_id = 'student-photos'
  and private.student_photo_read_allowed(name)
);

create policy student_photos_insert_active_staff
on storage.objects for insert to authenticated
with check (
  bucket_id = 'student-photos'
  and private.student_photo_write_allowed(name)
);

create policy student_photos_update_active_staff
on storage.objects for update to authenticated
using (
  bucket_id = 'student-photos'
  and private.student_photo_write_allowed(name)
)
with check (
  bucket_id = 'student-photos'
  and private.student_photo_write_allowed(name)
);

create policy student_photos_delete_active_staff
on storage.objects for delete to authenticated
using (
  bucket_id = 'student-photos'
  and private.student_photo_write_allowed(name)
);

-- No member-waivers bucket, waiver policy, table, student record, link, or
-- photo URL is referenced by a write in this migration.

commit;
