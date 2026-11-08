-- UNTESTED / DO NOT APPLY UNTIL THE READ-ONLY INVENTORY IS REVIEWED.
-- This migration creates private, append-only waiver records. It does not seed
-- or activate a waiver version; a private source document must exist before an
-- administrator explicitly creates and approves one.

begin;

do $$
begin
  if to_regclass('public.students') is null
    or to_regclass('public.gym_settings') is null
    or to_regclass('public.gym_staff') is null then
    raise exception 'Waiver migration requires public.students, public.gym_settings, and public.gym_staff.';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'students'
      and column_name = 'studentId' and data_type = 'bigint'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'students'
      and column_name = 'gym_id' and data_type = 'bigint'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'students'
      and column_name = 'waiver_signed' and data_type = 'boolean'
  ) then
    raise exception 'students must expose bigint "studentId", bigint gym_id, and boolean waiver_signed.';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'gym_settings'
      and column_name = 'id' and data_type = 'bigint'
  ) then
    raise exception 'gym_settings.id must be bigint.';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'gym_staff'
      and column_name in ('gym_id', 'user_id', 'role', 'is_active')
    group by table_schema, table_name
    having count(*) = 4
  ) then
    raise exception 'gym_staff must expose gym_id, user_id, role, and is_active.';
  end if;

  if not exists (
    select 1
    from pg_constraint con
    where con.conrelid = 'public.students'::regclass
      and con.conname = 'students_student_id_gym_id_key'
      and con.contype = 'u'
      and pg_get_constraintdef(con.oid) = 'UNIQUE ("studentId", gym_id)'
  ) then
    raise exception 'The existing students_student_id_gym_id_key UNIQUE ("studentId", gym_id) constraint is required and will not be created or replaced by this migration.';
  end if;

  if exists (select 1 from storage.buckets where id = 'member-waivers' and public) then
    raise exception 'The member-waivers bucket already exists as public; correct it outside this migration before proceeding.';
  end if;

  if to_regprocedure('extensions.digest(bytea,text)') is null then
    raise exception 'The installed pgcrypto function extensions.digest(bytea, text) is required to verify waiver text hashes.';
  end if;
end
$$;

create table public.waiver_versions (
  id uuid primary key default gen_random_uuid(),
  gym_id bigint not null references public.gym_settings(id) on delete restrict,
  title text not null check (length(btrim(title)) > 0),
  exact_text text not null check (length(btrim(exact_text)) > 0),
  content_sha256 char(64) not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  source_document_path text not null check (length(btrim(source_document_path)) > 0),
  approval_status text not null default 'draft' check (approval_status in ('draft', 'approved', 'retired')),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  approved_by uuid,
  approved_at timestamptz,
  constraint waiver_versions_approval_audit_check check (
    (approval_status = 'draft' and approved_by is null and approved_at is null)
    or (approval_status in ('approved', 'retired') and approved_by is not null and approved_at is not null)
  ),
  constraint waiver_versions_id_gym_id_key unique (id, gym_id),
  constraint waiver_versions_gym_hash_key unique (gym_id, content_sha256)
);

create unique index waiver_versions_one_approved_per_gym_idx
  on public.waiver_versions (gym_id)
  where approval_status = 'approved';

create table public.member_waiver_submissions (
  id uuid primary key default gen_random_uuid(),
  gym_id bigint not null,
  student_id bigint not null,
  waiver_version_id uuid not null,
  participant_name text not null check (length(btrim(participant_name)) > 0),
  signer_name text not null check (length(btrim(signer_name)) > 0),
  signer_role text not null check (signer_role in ('participant', 'parent_guardian')),
  emergency_contact_name text not null check (length(btrim(emergency_contact_name)) > 0),
  emergency_contact_phone text not null check (length(btrim(emergency_contact_phone)) > 0),
  signature_object_path text not null unique check (length(btrim(signature_object_path)) > 0),
  signed_at timestamptz not null default now(),
  recorded_by uuid not null,
  idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  constraint member_waiver_submissions_student_gym_fkey
    foreign key (student_id, gym_id)
    references public.students("studentId", gym_id) on delete restrict,
  constraint member_waiver_submissions_version_gym_fkey
    foreign key (waiver_version_id, gym_id)
    references public.waiver_versions(id, gym_id) on delete restrict,
  constraint member_waiver_submissions_gym_idempotency_key
    unique (gym_id, idempotency_key)
);

create index member_waiver_submissions_student_idx
  on public.member_waiver_submissions (gym_id, student_id, signed_at desc);

create or replace function public.waiver_active_staff(p_gym_id bigint)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.gym_staff staff
    where staff.gym_id = p_gym_id
      and staff.user_id = auth.uid()
      and staff.is_active = true
      and staff.role in ('admin', 'coach')
  );
$$;

create or replace function public.waiver_active_admin(p_gym_id bigint)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.gym_staff staff
    where staff.gym_id = p_gym_id
      and staff.user_id = auth.uid()
      and staff.is_active = true
      and staff.role = 'admin'
  );
$$;

create or replace function public.prevent_waiver_submission_mutation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  raise exception 'Waiver submissions are append-only.';
end;
$$;

create or replace function public.prevent_waiver_version_mutation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.id is distinct from old.id
    or new.gym_id is distinct from old.gym_id
    or new.title is distinct from old.title
    or new.exact_text is distinct from old.exact_text
    or new.content_sha256 is distinct from old.content_sha256
    or new.source_document_path is distinct from old.source_document_path
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at then
    raise exception 'Waiver version content and identity are immutable.';
  end if;

  if old.approval_status = 'draft'
    and new.approval_status = 'approved'
    and new.approved_by = auth.uid()
    and new.approved_at is not null then
    return new;
  end if;

  if old.approval_status = 'approved'
    and new.approval_status = 'retired'
    and new.approved_by is not distinct from old.approved_by
    and new.approved_at is not distinct from old.approved_at then
    return new;
  end if;

  raise exception 'Waiver versions may only transition from draft to approved or approved to retired.';
end;
$$;

create trigger member_waiver_submissions_immutable
before update or delete on public.member_waiver_submissions
for each row execute function public.prevent_waiver_submission_mutation();

create trigger waiver_versions_immutable
before update on public.waiver_versions
for each row execute function public.prevent_waiver_version_mutation();

alter table public.waiver_versions enable row level security;
alter table public.member_waiver_submissions enable row level security;

revoke all on table public.waiver_versions from public, anon;
revoke all on table public.member_waiver_submissions from public, anon;
revoke insert, update, delete on table public.waiver_versions from authenticated;
revoke insert, update, delete on table public.member_waiver_submissions from authenticated;
grant select on table public.waiver_versions to authenticated;
grant select on table public.member_waiver_submissions to authenticated;

create policy waiver_versions_select_active_staff
on public.waiver_versions for select to authenticated
using (public.waiver_active_staff(gym_id));

create policy member_waiver_submissions_select_active_staff
on public.member_waiver_submissions for select to authenticated
using (public.waiver_active_staff(gym_id));

insert into storage.buckets (id, name, public)
values ('member-waivers', 'member-waivers', false)
on conflict (id) do nothing;

create policy member_waivers_read_active_staff
on storage.objects for select to authenticated
using (
  bucket_id = 'member-waivers'
  and (storage.foldername(name))[1] = 'gym'
  and (storage.foldername(name))[2] ~ '^[0-9]+$'
  and public.waiver_active_staff(((storage.foldername(name))[2])::bigint)
);

create policy member_waivers_insert_active_staff
on storage.objects for insert to authenticated
with check (
  bucket_id = 'member-waivers'
  and (storage.foldername(name))[1] = 'gym'
  and (storage.foldername(name))[2] ~ '^[0-9]+$'
  and public.waiver_active_staff(((storage.foldername(name))[2])::bigint)
);

create or replace function public.create_waiver_version(
  p_title text,
  p_exact_text text,
  p_content_sha256 char(64),
  p_source_document_path text
)
returns uuid
language plpgsql
security definer
set search_path = public, storage, pg_temp
as $$
declare
  v_gym_id bigint;
  v_membership_count integer;
  v_membership_role text;
  v_id uuid;
  v_source_prefix text;
begin
  select min(staff.gym_id), count(*), min(staff.role)
  into v_gym_id, v_membership_count, v_membership_role
  from public.gym_staff staff
  where staff.user_id = auth.uid()
    and staff.is_active = true
    and staff.role in ('admin', 'coach')
  ;
  if v_membership_count <> 1
    or v_gym_id is null
    or v_membership_role <> 'admin'
    or not public.waiver_active_admin(v_gym_id) then
    raise exception 'Exactly one active gym administrator membership is required.';
  end if;
  if p_title is null or p_exact_text is null or p_content_sha256 is null or p_source_document_path is null
    or length(btrim(p_title)) = 0 or length(btrim(p_exact_text)) = 0
    or p_content_sha256 !~ '^[0-9a-f]{64}$' or length(btrim(p_source_document_path)) = 0 then
    raise exception 'A title, exact text, SHA-256 hash, and private source document path are required.';
  end if;
  if p_content_sha256 <> encode(extensions.digest(convert_to(p_exact_text, 'UTF8'), 'sha256'), 'hex') then
    raise exception 'The supplied waiver text hash does not match the UTF-8 SHA-256 hash of the exact text.';
  end if;
  v_source_prefix := format('gym/%s/waivers/', v_gym_id);
  if left(btrim(p_source_document_path), length(v_source_prefix)) <> v_source_prefix then
    raise exception 'The waiver source document must be stored in this gym''s private waiver path.';
  end if;

  insert into public.waiver_versions (gym_id, title, exact_text, content_sha256, source_document_path, created_by)
  values (v_gym_id, btrim(p_title), p_exact_text, p_content_sha256, btrim(p_source_document_path), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.approve_waiver_version(p_waiver_version_id uuid)
returns void
language plpgsql
security definer
set search_path = public, storage, pg_temp
as $$
declare
  v_version public.waiver_versions%rowtype;
begin
  if p_waiver_version_id is null then
    raise exception 'A waiver version is required.';
  end if;
  select * into v_version from public.waiver_versions where id = p_waiver_version_id for update;
  if not found or not public.waiver_active_admin(v_version.gym_id) then
    raise exception 'An active gym administrator is required.';
  end if;
  if v_version.approval_status <> 'draft' then
    raise exception 'Only a draft waiver version can be approved.';
  end if;
  if left(v_version.source_document_path, length(format('gym/%s/waivers/', v_version.gym_id)))
    <> format('gym/%s/waivers/', v_version.gym_id) then
    raise exception 'The waiver source document is outside this gym''s private waiver path.';
  end if;
  if not exists (
    select 1 from storage.objects
    where bucket_id = 'member-waivers' and name = v_version.source_document_path
  ) then
    raise exception 'The private source document must exist before approval.';
  end if;

  update public.waiver_versions
  set approval_status = 'retired'
  where gym_id = v_version.gym_id and approval_status = 'approved';

  update public.waiver_versions
  set approval_status = 'approved', approved_by = auth.uid(), approved_at = now()
  where id = v_version.id;
end;
$$;

create or replace function public.finalize_member_waiver_submission(
  p_student_id bigint,
  p_waiver_version_id uuid,
  p_participant_name text,
  p_signer_name text,
  p_signer_role text,
  p_emergency_contact_name text,
  p_emergency_contact_phone text,
  p_signature_object_path text,
  p_idempotency_key uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, storage, pg_temp
as $$
declare
  v_gym_id bigint;
  v_membership_count integer;
  v_version public.waiver_versions%rowtype;
  v_existing public.member_waiver_submissions%rowtype;
  v_expected_signature_path text;
  v_submission_id uuid;
begin
  if p_student_id is null or p_waiver_version_id is null
    or p_participant_name is null or p_signer_name is null or p_signer_role is null
    or p_emergency_contact_name is null or p_emergency_contact_phone is null
    or p_signature_object_path is null or p_idempotency_key is null then
    raise exception 'All waiver submission parameters, including the idempotency key, are required.';
  end if;

  select min(staff.gym_id), count(*) into v_gym_id, v_membership_count
  from public.gym_staff staff
  where staff.user_id = auth.uid() and staff.is_active = true and staff.role in ('admin', 'coach')
  ;
  if v_membership_count <> 1 or v_gym_id is null or not public.waiver_active_staff(v_gym_id) then
    raise exception 'Exactly one active gym staff membership is required.';
  end if;
  if length(btrim(p_participant_name)) = 0 or length(btrim(p_signer_name)) = 0
    or length(btrim(p_emergency_contact_name)) = 0 or length(btrim(p_emergency_contact_phone)) = 0
    or p_signer_role not in ('participant', 'parent_guardian') then
    raise exception 'Complete participant, signer, role, and emergency contact details are required.';
  end if;
  if not exists (
    select 1 from public.students
    where "studentId" = p_student_id and gym_id = v_gym_id
  ) then
    raise exception 'The selected member does not belong to this gym.';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      format('member-waiver-submission:%s:%s', v_gym_id, p_idempotency_key),
      0
    )
  );

  select * into v_existing
  from public.member_waiver_submissions
  where gym_id = v_gym_id and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.student_id is distinct from p_student_id
      or v_existing.waiver_version_id is distinct from p_waiver_version_id
      or v_existing.participant_name is distinct from btrim(p_participant_name)
      or v_existing.signer_name is distinct from btrim(p_signer_name)
      or v_existing.signer_role is distinct from p_signer_role
      or v_existing.emergency_contact_name is distinct from btrim(p_emergency_contact_name)
      or v_existing.emergency_contact_phone is distinct from btrim(p_emergency_contact_phone)
      or v_existing.signature_object_path is distinct from p_signature_object_path
      or v_existing.recorded_by is distinct from auth.uid() then
      raise exception 'This waiver retry does not match the original submission.';
    end if;
    return v_existing.id;
  end if;

  select * into v_version
  from public.waiver_versions
  where id = p_waiver_version_id and gym_id = v_gym_id and approval_status = 'approved'
  for share;
  if not found then
    raise exception 'The selected waiver version is not approved for this gym.';
  end if;

  v_expected_signature_path := format(
    'gym/%s/members/%s/waivers/%s/signature.svg',
    v_gym_id, p_student_id, p_idempotency_key
  );
  if p_signature_object_path <> v_expected_signature_path then
    raise exception 'The signature file path is invalid.';
  end if;
  if not exists (
    select 1 from storage.objects
    where bucket_id = 'member-waivers'
      and name = v_version.source_document_path
  ) then
    raise exception 'The approved waiver source document is unavailable.';
  end if;
  if not exists (
    select 1 from storage.objects
    where bucket_id = 'member-waivers'
      and name = p_signature_object_path
      and coalesce(metadata->>'mimetype', '') = 'image/svg+xml'
      and coalesce((metadata->>'size')::bigint, 0) > 0
  ) then
    raise exception 'The private signature file is missing or invalid.';
  end if;

  insert into public.member_waiver_submissions (
    gym_id, student_id, waiver_version_id, participant_name, signer_name, signer_role,
    emergency_contact_name, emergency_contact_phone, signature_object_path,
    recorded_by, idempotency_key
  ) values (
    v_gym_id, p_student_id, v_version.id, btrim(p_participant_name), btrim(p_signer_name), p_signer_role,
    btrim(p_emergency_contact_name), btrim(p_emergency_contact_phone), p_signature_object_path,
    auth.uid(), p_idempotency_key
  ) returning id into v_submission_id;

  update public.students
  set waiver_signed = true
  where "studentId" = p_student_id and gym_id = v_gym_id;
  if not found then
    raise exception 'The legacy waiver status could not be updated.';
  end if;
  return v_submission_id;
end;
$$;

revoke all on function public.waiver_active_staff(bigint) from public;
revoke all on function public.waiver_active_admin(bigint) from public;
revoke all on function public.prevent_waiver_submission_mutation() from public;
revoke all on function public.prevent_waiver_version_mutation() from public;
revoke all on function public.create_waiver_version(text, text, char(64), text) from public;
revoke all on function public.approve_waiver_version(uuid) from public;
revoke all on function public.finalize_member_waiver_submission(bigint, uuid, text, text, text, text, text, text, uuid) from public;
grant execute on function public.waiver_active_staff(bigint) to authenticated;
grant execute on function public.waiver_active_admin(bigint) to authenticated;
grant execute on function public.create_waiver_version(text, text, char(64), text) to authenticated;
grant execute on function public.approve_waiver_version(uuid) to authenticated;
grant execute on function public.finalize_member_waiver_submission(bigint, uuid, text, text, text, text, text, text, uuid) to authenticated;

commit;
