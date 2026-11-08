-- DEPLOYMENT MIGRATION — DEPLOY ONLY WITH EXPLICIT APPROVAL
-- Grau Zero Family Self-Check-In with Staff Approval.
-- Creates no Gym 4 rollout row: the feature is disabled after this migration.
-- Attendance is inserted only by staff approval and continues to use the
-- existing attendance snapshot trigger.

begin;

do $$
declare
  v_attendance_index text;
begin
  if exists (select 1 from pg_namespace where nspname = 'grau_self_check_in_private') then
    raise exception 'grau_self_check_in_private already exists; stop and inventory it before deployment.';
  end if;

  if to_regclass('public.classes') is null
     or to_regclass('public.attendance') is null
     or to_regclass('public.students') is null
     or to_regclass('public.member_account_links') is null
     or to_regclass('public.gym_staff') is null
     or to_regclass('public.gym_settings') is null then
    raise exception 'Required Grau Zero tables are missing.';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'classes'
      and column_name in ('id', 'gym_id', 'class_name', 'class_date', 'start_time', 'status', 'is_active', 'class_audience')
    group by table_schema, table_name
    having count(*) = 8
  ) then
    raise exception 'classes does not match the reviewed lifecycle contract.';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'attendance'
      and column_name in ('id', 'gym_id', 'student_id', 'class_id', 'check_in_date', 'class_type', 'notes')
    group by table_schema, table_name
    having count(*) = 7
  ) then
    raise exception 'attendance does not match the reviewed insert contract.';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'students'
      and column_name in ('studentId', 'gym_id', 'membership_status', 'programs')
    group by table_schema, table_name
    having count(*) = 4
  ) then
    raise exception 'students does not match the reviewed eligibility contract.';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'students' and column_name = 'studentId'
      and data_type = 'bigint' and is_nullable = 'NO'
  ) or not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'students' and column_name = 'programs'
      and data_type = 'ARRAY' and udt_name = '_text'
  ) or not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'attendance' and column_name = 'id'
      and is_identity = 'YES'
  ) then
    raise exception 'Reviewed students or attendance identity types do not match.';
  end if;

  if not exists (
    select 1
    from information_schema.columns as attendance_column
    where attendance_column.table_schema = 'public'
      and attendance_column.table_name = 'attendance'
      and attendance_column.column_name in ('gym_id', 'student_id', 'class_id')
      and attendance_column.data_type = 'bigint'
    group by attendance_column.table_schema, attendance_column.table_name
    having count(*) = 3
  ) then
    raise exception 'attendance identity columns do not match the reviewed bigint contract.';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'member_account_links'
      and column_name in ('gym_id', 'student_id', 'user_id', 'status', 'approved_at', 'revoked_at')
    group by table_schema, table_name
    having count(*) = 6
  ) then
    raise exception 'member_account_links does not match the reviewed approval contract.';
  end if;

  select pg_get_indexdef(index_info.indexrelid)
  into v_attendance_index
  from pg_index as index_info
  join pg_class as index_relation on index_relation.oid = index_info.indexrelid
  where index_info.indrelid = 'public.attendance'::regclass
    and index_relation.relname = 'attendance_unique_class_student';

  if v_attendance_index is null
     or v_attendance_index not ilike '%unique%'
     or v_attendance_index not ilike '%(class_id, student_id)%'
     or v_attendance_index not ilike '%class_id is not null%'
     or v_attendance_index not ilike '%student_id is not null%' then
    raise exception 'attendance_unique_class_student does not match the reviewed partial unique-index contract.';
  end if;

  if not exists (
    select 1 from pg_trigger as trigger_info
    join pg_proc as trigger_function on trigger_function.oid = trigger_info.tgfoid
    where trigger_info.tgrelid = 'public.attendance'::regclass
      and not trigger_info.tgisinternal
      and trigger_info.tgenabled in ('O', 'A')
      and (trigger_info.tgtype & 2) = 2
      and (trigger_info.tgtype & 4) = 4
      and trigger_function.proname = 'snapshot_attendance_progress_classification'
  ) then
    raise exception 'The attendance classification snapshot trigger is not enabled.';
  end if;
end
$$;

create schema grau_self_check_in_private authorization postgres;
revoke all on schema grau_self_check_in_private from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema grau_self_check_in_private revoke execute on functions from public;

create table grau_self_check_in_private.gym_rollouts (
  gym_id bigint primary key references public.gym_settings(id),
  enabled boolean not null default false,
  enabled_at timestamptz,
  enabled_by uuid,
  disabled_at timestamptz,
  disabled_by uuid,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check ((enabled and enabled_at is not null and enabled_by is not null) or not enabled)
);

create table grau_self_check_in_private.request_batches (
  id uuid primary key,
  gym_id bigint not null references public.gym_settings(id),
  class_id bigint not null references public.classes(id),
  family_user_id uuid not null,
  student_ids bigint[] not null,
  created_at timestamptz not null default clock_timestamp(),
  check (cardinality(student_ids) > 0),
  unique (family_user_id, id)
);

create table grau_self_check_in_private.requests (
  id bigint generated always as identity primary key,
  batch_id uuid not null references grau_self_check_in_private.request_batches(id),
  gym_id bigint not null references public.gym_settings(id),
  class_id bigint not null references public.classes(id),
  student_id bigint not null,
  family_user_id uuid not null,
  state text not null check (state in ('pending', 'approved', 'declined', 'already_checked_in', 'unavailable', 'ineligible')),
  reason text,
  requested_at timestamptz not null default clock_timestamp(),
  resolved_at timestamptz,
  resolved_by uuid,
  resolution_key uuid,
  resolution_decision text check (resolution_decision in ('approve', 'decline')),
  attendance_id bigint,
  check ((state = 'pending' and resolved_at is null and resolved_by is null) or state <> 'pending'),
  -- A student can have multiple approved family accounts, but only one request
  -- and one staff resolution may exist for the class.
  unique (class_id, student_id)
);

create index requests_staff_queue_idx
  on grau_self_check_in_private.requests (gym_id, class_id, state, requested_at, id);

-- A request owned by another approved family account cannot be attached to
-- this caller's batch. Persist the deliberately non-identifying outcome so a
-- same-UUID retry still returns the exact original result set.
create table grau_self_check_in_private.batch_conflict_outcomes (
  batch_id uuid not null references grau_self_check_in_private.request_batches(id),
  student_id bigint not null,
  state text not null check (state = 'unavailable'),
  reason text not null,
  primary key (batch_id, student_id)
);

-- A bulk resolution key belongs to one exact staff caller and one normalized
-- selection. It is private so a caller cannot inspect another staff member's
-- retry history.
create table grau_self_check_in_private.bulk_resolution_batches (
  resolution_key uuid primary key,
  gym_id bigint not null references public.gym_settings(id),
  class_id bigint not null references public.classes(id),
  staff_user_id uuid not null,
  request_ids bigint[] not null,
  created_at timestamptz not null default clock_timestamp(),
  check (cardinality(request_ids) > 0)
);

create table grau_self_check_in_private.request_events (
  id bigint generated always as identity primary key,
  request_id bigint not null references grau_self_check_in_private.requests(id),
  gym_id bigint not null,
  class_id bigint not null,
  student_id bigint not null,
  event_type text not null check (event_type in ('requested', 'approved', 'declined', 'already_checked_in', 'unavailable', 'ineligible')),
  actor_user_id uuid not null,
  occurred_at timestamptz not null default clock_timestamp(),
  detail text
);

alter table grau_self_check_in_private.gym_rollouts enable row level security;
alter table grau_self_check_in_private.request_batches enable row level security;
alter table grau_self_check_in_private.requests enable row level security;
alter table grau_self_check_in_private.batch_conflict_outcomes enable row level security;
alter table grau_self_check_in_private.bulk_resolution_batches enable row level security;
alter table grau_self_check_in_private.request_events enable row level security;

create function grau_self_check_in_private.request_events_immutable()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, grau_self_check_in_private, pg_temp
as $$
begin
  raise exception 'Self-check-in audit events are immutable.' using errcode = '42501';
end;
$$;

create trigger request_events_immutable
before update or delete on grau_self_check_in_private.request_events
for each row execute function grau_self_check_in_private.request_events_immutable();

create function grau_self_check_in_private.record_batch_conflict(
  p_batch_id uuid,
  p_student_id bigint
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, grau_self_check_in_private, pg_temp
as $$
begin
  insert into grau_self_check_in_private.batch_conflict_outcomes(batch_id, student_id, state, reason)
  values (p_batch_id, p_student_id, 'unavailable', 'A family check-in request already exists for this member.')
  on conflict (batch_id, student_id) do nothing;
end;
$$;

create function grau_self_check_in_private.require_rollout(p_gym_id bigint)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, grau_self_check_in_private, pg_temp
as $$
declare
  v_rollout grau_self_check_in_private.gym_rollouts%rowtype;
begin
  if p_gym_id is null then raise exception 'Gym ID is required.' using errcode = '22023'; end if;
  select * into v_rollout from grau_self_check_in_private.gym_rollouts where gym_id = p_gym_id for update;
  if not found or not v_rollout.enabled then
    raise exception 'Family self-check-in is not enabled for this academy.' using errcode = '42501';
  end if;
end;
$$;

create function grau_self_check_in_private.require_active_staff(p_gym_id bigint)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, grau_self_check_in_private, pg_temp
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.gym_staff as staff
    where staff.user_id = auth.uid()
      and staff.gym_id = p_gym_id
      and staff.is_active = true
      and staff.role in ('admin', 'coach')
  ) then
    raise exception 'Active academy administrator or coach membership is required.' using errcode = '42501';
  end if;
end;
$$;

create function grau_self_check_in_private.require_approved_family_gym(p_gym_id bigint)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, grau_self_check_in_private, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign-in is required.' using errcode = '42501';
  end if;

  perform 1
  from public.member_account_links as link
  where link.user_id = auth.uid()
    and link.gym_id = p_gym_id
    and link.status = 'approved'
    and link.approved_at is not null
    and link.revoked_at is null
  for share;

  if not found then
    raise exception 'An approved family link is required.' using errcode = '42501';
  end if;
end;
$$;

create function grau_self_check_in_private.require_approved_family_batch(
  p_gym_id bigint,
  p_student_ids bigint[]
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, grau_self_check_in_private, pg_temp
as $$
declare
  v_student_id bigint;
  v_ids bigint[];
begin
  if auth.uid() is null then
    raise exception 'Sign-in is required.' using errcode = '42501';
  end if;

  select array_agg(distinct candidate.student_id order by candidate.student_id)
  into v_ids
  from unnest(p_student_ids) as candidate(student_id)
  where candidate.student_id is not null and candidate.student_id > 0;

  if v_ids is null or cardinality(v_ids) <> cardinality(p_student_ids) then
    raise exception 'Saved family check-in request is invalid.' using errcode = '22023';
  end if;

  -- Lock every linked row in ascending student order. A retry returns no
  -- request data unless the caller still has approved, non-revoked access to
  -- every member saved in its original batch.
  foreach v_student_id in array v_ids loop
    perform 1
    from public.member_account_links as link
    where link.user_id = auth.uid()
      and link.gym_id = p_gym_id
      and link.student_id = v_student_id
      and link.status = 'approved'
      and link.approved_at is not null
      and link.revoked_at is null
    for share;

    if not found then
      raise exception 'An approved family link is required.' using errcode = '42501';
    end if;
  end loop;
end;
$$;

create function grau_self_check_in_private.claim_bulk_resolution_batch(
  p_gym_id bigint,
  p_class_id bigint,
  p_request_ids bigint[],
  p_resolution_key uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, grau_self_check_in_private, pg_temp
as $$
declare
  v_batch grau_self_check_in_private.bulk_resolution_batches%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Sign-in is required.' using errcode = '42501';
  end if;

  -- This row is locked only after the public RPC has locked the rollout and
  -- class and verified staff access. No family or single-request path locks it.
  select * into v_batch
  from grau_self_check_in_private.bulk_resolution_batches
  where resolution_key = p_resolution_key
  for update;

  if not found then
    insert into grau_self_check_in_private.bulk_resolution_batches(
      resolution_key, gym_id, class_id, staff_user_id, request_ids
    )
    values (p_resolution_key, p_gym_id, p_class_id, auth.uid(), p_request_ids)
    on conflict (resolution_key) do nothing
    returning * into v_batch;

    if not found then
      select * into v_batch
      from grau_self_check_in_private.bulk_resolution_batches
      where resolution_key = p_resolution_key
      for update;
    end if;
  end if;

  if v_batch.staff_user_id <> auth.uid()
     or v_batch.gym_id <> p_gym_id
     or v_batch.class_id <> p_class_id
     or v_batch.request_ids is distinct from p_request_ids then
    raise exception 'Bulk retry key does not match this approval selection.' using errcode = '22023';
  end if;
end;
$$;

create function grau_self_check_in_private.lock_and_validate_class(p_gym_id bigint, p_class_id bigint)
returns public.classes
language plpgsql
security definer
set search_path = pg_catalog, public, grau_self_check_in_private, pg_temp
as $$
declare
  v_class public.classes%rowtype;
  v_time_zone text;
  v_start timestamptz;
  v_now timestamptz;
begin
  select * into v_class from public.classes where id = p_class_id and gym_id = p_gym_id for update;
  if not found then raise exception 'Class was not found for this academy.' using errcode = '42501'; end if;
  select settings.time_zone into v_time_zone from public.gym_settings as settings where settings.id = p_gym_id;
  if v_time_zone is null or not exists (select 1 from pg_timezone_names where name = v_time_zone) then
    raise exception 'This academy has an invalid time zone configuration.' using errcode = '22023';
  end if;
  if v_class.class_date is null or v_class.start_time is null
     or v_class.class_date <> (date_trunc('day', v_class.class_date at time zone 'UTC') at time zone 'UTC')
     or v_class.class_name is null or btrim(v_class.class_name::text) = ''
     or v_class.class_audience is null or v_class.class_audience not in ('kids', 'adults', 'mixed') then
    raise exception 'This class has incomplete or invalid scheduling information.' using errcode = '22023';
  end if;
  v_start := (((v_class.class_date at time zone 'UTC')::date + v_class.start_time) at time zone v_time_zone);
  -- Scheduled records have a conservative stale-record cutoff. In Progress
  -- records deliberately remain available until staff completes or cancels.
  v_now := clock_timestamp();
  if (v_class.status = 'Scheduled' and coalesce(v_class.is_active, false) = false) then
    if v_now < v_start - interval '15 minutes' then
      raise exception 'Family check-in requests open 15 minutes before class start.' using errcode = '42501';
    end if;
    if v_now >= v_start + interval '12 hours' then
      raise exception 'This scheduled class is too old to accept family check-in requests.' using errcode = '42501';
    end if;
  elsif v_class.status = 'In Progress' and v_class.is_active = true then
    null;
  else
    raise exception 'This class is not accepting family check-in requests.' using errcode = '42501';
  end if;
  return v_class;
end;
$$;

create function public.family_self_check_in_available_classes(p_gym_id bigint)
returns table (class_id bigint, gym_id bigint, class_name text, class_date timestamptz, start_time time, class_audience text, lifecycle text, opens_at timestamptz)
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, grau_self_check_in_private, pg_temp
as $$
declare
  v_time_zone text;
begin
  -- Family authorization is checked before the class row is locked, so an
  -- unauthorized caller cannot use this RPC to probe a class or its students.
  perform grau_self_check_in_private.require_approved_family_gym(p_gym_id);
  perform grau_self_check_in_private.require_rollout(p_gym_id);
  select time_zone into v_time_zone from public.gym_settings where id = p_gym_id;
  if v_time_zone is null or not exists (select 1 from pg_timezone_names where name = v_time_zone) then
    raise exception 'This academy has an invalid time zone configuration.' using errcode = '22023';
  end if;
  return query
  select c.id, c.gym_id, c.class_name::text, c.class_date, c.start_time, c.class_audience::text,
    case when c.status = 'In Progress' then 'in_progress' else 'scheduled' end,
    ((((c.class_date at time zone 'UTC')::date + c.start_time) at time zone v_time_zone) - interval '15 minutes')
  from public.classes as c
  where c.gym_id = p_gym_id
    and c.class_date is not null and c.start_time is not null
    and c.class_date = (date_trunc('day', c.class_date at time zone 'UTC') at time zone 'UTC')
    and c.class_name is not null and btrim(c.class_name::text) <> ''
    and c.class_audience in ('kids', 'adults', 'mixed')
    and ((c.status = 'Scheduled' and coalesce(c.is_active, false) = false)
      or (c.status = 'In Progress' and c.is_active = true))
    and clock_timestamp() >= (((c.class_date at time zone 'UTC')::date + c.start_time) at time zone v_time_zone) - interval '15 minutes'
    and (c.status <> 'Scheduled'
      or clock_timestamp() < (((c.class_date at time zone 'UTC')::date + c.start_time) at time zone v_time_zone) + interval '12 hours')
  order by c.class_date, c.start_time, c.id;
end;
$$;

create function public.family_self_check_in_eligible_students(p_gym_id bigint, p_class_id bigint)
returns table (student_id bigint, gym_id bigint, first_name text, last_name text, membership_status text, programs text[], eligibility text, reason text)
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, grau_self_check_in_private, pg_temp
as $$
declare
  v_class public.classes%rowtype;
begin
  perform grau_self_check_in_private.require_approved_family_gym(p_gym_id);
  perform grau_self_check_in_private.require_rollout(p_gym_id);
  v_class := grau_self_check_in_private.lock_and_validate_class(p_gym_id, p_class_id);
  return query
  select s."studentId", s.gym_id, s.first_name::text, s.last_name::text, lower(btrim(s.membership_status::text)), s.programs::text[],
    case
      when exists (select 1 from public.attendance as a where a.gym_id = p_gym_id and a.class_id = p_class_id and a.student_id = s."studentId") then 'already_checked_in'
      when exists (select 1 from grau_self_check_in_private.requests as r where r.class_id = p_class_id and r.student_id = s."studentId" and r.family_user_id = auth.uid()) then 'already_requested'
      when lower(btrim(coalesce(s.membership_status::text, ''))) not in ('active', 'trial') then 'ineligible'
      when v_class.class_audience = 'mixed' and not coalesce('kids' = any(s.programs) or 'adults' = any(s.programs), false) then 'ineligible'
      when v_class.class_audience <> 'mixed' and not coalesce(v_class.class_audience = any(s.programs), false) then 'ineligible'
      else 'eligible'
    end,
    case
      when lower(btrim(coalesce(s.membership_status::text, ''))) not in ('active', 'trial') then 'Active or Trial membership is required.'
      when v_class.class_audience = 'mixed' and not coalesce('kids' = any(s.programs) or 'adults' = any(s.programs), false) then 'This member is not assigned to this class audience.'
      when v_class.class_audience <> 'mixed' and not coalesce(v_class.class_audience = any(s.programs), false) then 'This member is not assigned to this class audience.'
      else null
    end
  from public.member_account_links as link
  join public.students as s on s."studentId" = link.student_id and s.gym_id = link.gym_id
  where link.user_id = auth.uid() and link.gym_id = p_gym_id
    and link.status = 'approved' and link.approved_at is not null and link.revoked_at is null
  order by s.last_name nulls last, s.first_name, s."studentId";
end;
$$;

create function public.family_self_check_in_request(p_gym_id bigint, p_class_id bigint, p_student_ids bigint[], p_request_key uuid)
returns table (student_id bigint, request_id bigint, state text, reason text)
language plpgsql
security definer
set search_path = pg_catalog, public, grau_self_check_in_private, pg_temp
as $$
declare
  v_class public.classes%rowtype;
  v_student_id bigint;
  v_batch grau_self_check_in_private.request_batches%rowtype;
  v_request grau_self_check_in_private.requests%rowtype;
  v_student public.students%rowtype;
  v_ids bigint[];
  v_reason text;
  v_batch_exists boolean;
begin
  if auth.uid() is null then raise exception 'Sign-in is required.' using errcode = '42501'; end if;
  if p_request_key is null or p_student_ids is null or cardinality(p_student_ids) = 0 then raise exception 'A retry key and at least one student are required.' using errcode = '22023'; end if;
  select array_agg(distinct candidate.student_id order by candidate.student_id) into v_ids from unnest(p_student_ids) as candidate(student_id) where candidate.student_id is not null and candidate.student_id > 0;
  if v_ids is null or cardinality(v_ids) <> cardinality(p_student_ids) then raise exception 'Student IDs must be positive and unique.' using errcode = '22023'; end if;
  -- This check is repeated for both first submissions and UUID retries before
  -- a class or prior request is inspected.
  perform grau_self_check_in_private.require_approved_family_gym(p_gym_id);
  perform grau_self_check_in_private.require_rollout(p_gym_id);
  -- The rollout row is locked above, serializing initial submissions that use
  -- the same UUID. Lock by the UUID itself (not by the current user) so a
  -- cross-account UUID collision cannot reveal another family's request.
  select * into v_batch from grau_self_check_in_private.request_batches where id = p_request_key for update;
  v_batch_exists := found;
  if v_batch_exists then
    if v_batch.family_user_id <> auth.uid()
       or v_batch.gym_id <> p_gym_id
       or v_batch.class_id <> p_class_id
       or v_batch.student_ids is distinct from v_ids then
      raise exception 'Retry key does not match this family check-in request.' using errcode = '22023';
    end if;
    perform grau_self_check_in_private.require_approved_family_batch(
      v_batch.gym_id,
      v_batch.student_ids
    );
    return query
    select result.student_id, result.request_id, result.state, result.reason
    from (
      select r.student_id, r.id as request_id, r.state, r.reason
      from grau_self_check_in_private.requests as r
      where r.batch_id = v_batch.id
      union all
      select conflict.student_id, null::bigint, conflict.state, conflict.reason
      from grau_self_check_in_private.batch_conflict_outcomes as conflict
      where conflict.batch_id = v_batch.id
    ) as result
    order by result.student_id;
    return;
  end if;
  v_class := grau_self_check_in_private.lock_and_validate_class(p_gym_id, p_class_id);
  -- A new batch is created only after every selected member has an approved,
  -- non-revoked link. The helper locks those links in deterministic student-ID
  -- order, so a revocation cannot race this submission into private records.
  perform grau_self_check_in_private.require_approved_family_batch(
    p_gym_id,
    v_ids
  );
  insert into grau_self_check_in_private.request_batches(id, gym_id, class_id, family_user_id, student_ids) values (p_request_key, p_gym_id, p_class_id, auth.uid(), v_ids) returning * into v_batch;
  foreach v_student_id in array v_ids loop
    select * into v_student from public.students as student where student."studentId" = v_student_id and student.gym_id = p_gym_id for update;
    if not found then
      insert into grau_self_check_in_private.requests(batch_id, gym_id, class_id, student_id, family_user_id, state, reason)
      values (v_batch.id, p_gym_id, p_class_id, v_student_id, auth.uid(), 'ineligible', 'This member is not available at this academy.')
      on conflict (class_id, student_id) do nothing returning * into v_request;
      if not found then select * into v_request from grau_self_check_in_private.requests where class_id = p_class_id and student_id = v_student_id for update;
      if v_request.family_user_id <> auth.uid() then perform grau_self_check_in_private.record_batch_conflict(v_batch.id, v_student_id); return query select v_student_id, null::bigint, 'unavailable'::text, 'A family check-in request already exists for this member.'::text; continue; end if;
      if v_request.batch_id <> v_batch.id then raise exception 'A check-in request already exists for this member and class.' using errcode = '22023'; end if;
      else insert into grau_self_check_in_private.request_events(request_id, gym_id, class_id, student_id, event_type, actor_user_id, detail) values (v_request.id, p_gym_id, p_class_id, v_student_id, 'ineligible', auth.uid(), v_request.reason); end if;
      return query select v_student_id, v_request.id, v_request.state, v_request.reason;
      continue;
    end if;
    v_reason := case
      when lower(btrim(coalesce(v_student.membership_status::text, ''))) not in ('active', 'trial') then 'Active or Trial membership is required.'
      when v_class.class_audience = 'mixed' and not coalesce('kids' = any(v_student.programs) or 'adults' = any(v_student.programs), false) then 'This member is not assigned to this class audience.'
      when v_class.class_audience <> 'mixed' and not coalesce(v_class.class_audience = any(v_student.programs), false) then 'This member is not assigned to this class audience.'
      when exists (select 1 from public.attendance as attendance where attendance.gym_id = p_gym_id and attendance.class_id = p_class_id and attendance.student_id = v_student_id) then 'Attendance is already recorded.'
      else null
    end;
    if v_reason is not null then
      insert into grau_self_check_in_private.requests(batch_id, gym_id, class_id, student_id, family_user_id, state, reason)
      values (v_batch.id, p_gym_id, p_class_id, v_student_id, auth.uid(), case when v_reason = 'Attendance is already recorded.' then 'already_checked_in' else 'ineligible' end, v_reason)
      on conflict (class_id, student_id) do nothing returning * into v_request;
      if not found then select * into v_request from grau_self_check_in_private.requests where class_id = p_class_id and student_id = v_student_id for update;
      if v_request.family_user_id <> auth.uid() then perform grau_self_check_in_private.record_batch_conflict(v_batch.id, v_student_id); return query select v_student_id, null::bigint, 'unavailable'::text, 'A family check-in request already exists for this member.'::text; continue; end if;
      if v_request.batch_id <> v_batch.id then raise exception 'A check-in request already exists for this member and class.' using errcode = '22023'; end if;
      else insert into grau_self_check_in_private.request_events(request_id, gym_id, class_id, student_id, event_type, actor_user_id, detail) values (v_request.id, p_gym_id, p_class_id, v_student_id, v_request.state, auth.uid(), v_request.reason); end if;
      return query select v_student_id, v_request.id, v_request.state, v_request.reason;
      continue;
    end if;
    insert into grau_self_check_in_private.requests(batch_id, gym_id, class_id, student_id, family_user_id, state)
    values (v_batch.id, p_gym_id, p_class_id, v_student_id, auth.uid(), 'pending')
    on conflict (class_id, student_id) do nothing
    returning * into v_request;
    if not found then
      select * into v_request from grau_self_check_in_private.requests where class_id = p_class_id and student_id = v_student_id for update;
      if v_request.family_user_id <> auth.uid() then
        perform grau_self_check_in_private.record_batch_conflict(v_batch.id, v_student_id);
        return query select v_student_id, null::bigint, 'unavailable'::text, 'A family check-in request already exists for this member.'::text;
        continue;
      end if;
      if v_request.batch_id <> v_batch.id then
        raise exception 'A check-in request already exists for this member and class.' using errcode = '22023';
      end if;
      return query select v_student_id, v_request.id, v_request.state, coalesce(v_request.reason, 'A request already exists for this class.');
    else
      insert into grau_self_check_in_private.request_events(request_id, gym_id, class_id, student_id, event_type, actor_user_id) values (v_request.id, p_gym_id, p_class_id, v_student_id, 'requested', auth.uid());
      return query select v_student_id, v_request.id, 'pending'::text, null::text;
    end if;
  end loop;
end;
$$;

create function public.staff_self_check_in_list_requests(p_class_id bigint)
returns table (request_id bigint, student_id bigint, first_name text, last_name text, membership_status text, requested_at timestamptz, state text, reason text)
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, grau_self_check_in_private, pg_temp
as $$
declare v_gym_id bigint;
begin
  select gym_id into v_gym_id from public.classes where id = p_class_id;
  if v_gym_id is null then raise exception 'Class was not found.' using errcode = '42501'; end if;
  perform grau_self_check_in_private.require_rollout(v_gym_id);
  perform grau_self_check_in_private.require_active_staff(v_gym_id);
  return query select r.id, r.student_id, s.first_name::text, s.last_name::text, s.membership_status::text, r.requested_at, r.state, r.reason
  from grau_self_check_in_private.requests as r
  join public.students as s on s."studentId" = r.student_id and s.gym_id = r.gym_id
  where r.class_id = p_class_id and r.gym_id = v_gym_id
  order by case when r.state = 'pending' then 0 else 1 end, r.requested_at, r.id;
end;
$$;

create function grau_self_check_in_private.resolve_request(p_request_id bigint, p_decision text, p_resolution_key uuid)
returns table (student_id bigint, request_id bigint, state text, reason text)
language plpgsql
security definer
set search_path = pg_catalog, public, grau_self_check_in_private, pg_temp
as $$
declare
  v_request grau_self_check_in_private.requests%rowtype;
  v_class public.classes%rowtype;
  v_student public.students%rowtype;
  v_link public.member_account_links%rowtype;
  v_attendance_id bigint;
  v_outcome text;
  v_reason text;
  v_link_found boolean;
  v_student_found boolean;
begin
  if p_decision not in ('approve', 'decline') or p_resolution_key is null then raise exception 'A valid decision and retry key are required.' using errcode = '22023'; end if;
  select * into v_request from grau_self_check_in_private.requests where id = p_request_id;
  if not found then raise exception 'Check-in request was not found.' using errcode = '42501'; end if;
  perform grau_self_check_in_private.require_rollout(v_request.gym_id);
  perform grau_self_check_in_private.require_active_staff(v_request.gym_id);
  -- Lock order for staff resolution is rollout, class, request, family link,
  -- then student. Direct class lifecycle writes lock this same class row.
  select * into v_class from public.classes where id = v_request.class_id and gym_id = v_request.gym_id for update;
  if not found then raise exception 'Class was not found for this academy.' using errcode = '42501'; end if;
  select * into v_request from grau_self_check_in_private.requests where id = p_request_id for update;
  if v_request.state <> 'pending' then
    if v_request.resolution_key is not distinct from p_resolution_key
       and v_request.resolution_decision = p_decision then
      return query select v_request.student_id, v_request.id, v_request.state, v_request.reason;
      return;
    end if;
    raise exception 'This request has already been resolved with a different decision or retry key.' using errcode = '22023';
  end if;

  -- Declining is safe after the class closes: it changes only the private
  -- request record and audit trail. Approval always validates the live class
  -- lifecycle and request window while holding the class row lock.
  if p_decision = 'decline' then
    update grau_self_check_in_private.requests
    set state = 'declined', reason = 'Declined by academy staff.', resolved_at = clock_timestamp(),
        resolved_by = auth.uid(), resolution_key = p_resolution_key, resolution_decision = p_decision
    where id = v_request.id
    returning * into v_request;
    insert into grau_self_check_in_private.request_events(request_id, gym_id, class_id, student_id, event_type, actor_user_id, detail) values (v_request.id, v_request.gym_id, v_request.class_id, v_request.student_id, 'declined', auth.uid(), v_request.reason);
    return query select v_request.student_id, v_request.id, v_request.state, v_request.reason;
    return;
  end if;

  -- Use the established locked validation path for any operation that can
  -- insert attendance. Completed, Cancelled, NULL, and inconsistent classes
  -- therefore reject before the attendance insert is reached.
  v_class := grau_self_check_in_private.lock_and_validate_class(v_request.gym_id, v_request.class_id);
  select * into v_link from public.member_account_links as link where link.user_id = v_request.family_user_id and link.gym_id = v_request.gym_id and link.student_id = v_request.student_id and link.status = 'approved' and link.approved_at is not null and link.revoked_at is null for update;
  v_link_found := found;
  select * into v_student from public.students as student where student."studentId" = v_request.student_id and student.gym_id = v_request.gym_id for update;
  v_student_found := found;
  v_reason := case
    when not v_student_found then 'This member is no longer available at this academy.'
    when not v_link_found then 'The family link is no longer approved.'
    when lower(btrim(coalesce(v_student.membership_status::text, ''))) not in ('active', 'trial') then 'Active or Trial membership is required.'
    when v_class.class_audience = 'mixed' and not coalesce('kids' = any(v_student.programs) or 'adults' = any(v_student.programs), false) then 'This member is not assigned to this class audience.'
    when v_class.class_audience <> 'mixed' and not coalesce(v_class.class_audience = any(v_student.programs), false) then 'This member is not assigned to this class audience.'
    else null
  end;
  if v_reason is not null then
    update grau_self_check_in_private.requests set state = 'ineligible', reason = v_reason, resolved_at = clock_timestamp(), resolved_by = auth.uid(), resolution_key = p_resolution_key, resolution_decision = p_decision where id = v_request.id returning * into v_request;
    insert into grau_self_check_in_private.request_events(request_id, gym_id, class_id, student_id, event_type, actor_user_id, detail) values (v_request.id, v_request.gym_id, v_request.class_id, v_request.student_id, 'ineligible', auth.uid(), v_reason);
    return query select v_request.student_id, v_request.id, v_request.state, v_request.reason; return;
  end if;
  insert into public.attendance(student_id, class_id, gym_id, check_in_date, class_type, notes)
  values (v_request.student_id, v_request.class_id, v_request.gym_id, clock_timestamp(), v_class.class_name, '')
  on conflict (class_id, student_id) where (class_id is not null and student_id is not null) do nothing
  returning id into v_attendance_id;
  if v_attendance_id is null then
    select attendance.id into v_attendance_id
    from public.attendance as attendance
    where attendance.gym_id = v_request.gym_id
      and attendance.class_id = v_request.class_id
      and attendance.student_id = v_request.student_id
    for key share;
    if not found then
      raise exception 'Attendance insert conflicted without a matching class attendance record.' using errcode = 'P0001';
    end if;
    v_outcome := 'already_checked_in';
    v_reason := 'Attendance is already recorded.';
  else
    v_outcome := 'approved';
    v_reason := null;
  end if;
  update grau_self_check_in_private.requests set state = v_outcome, reason = v_reason, attendance_id = v_attendance_id, resolved_at = clock_timestamp(), resolved_by = auth.uid(), resolution_key = p_resolution_key, resolution_decision = p_decision where id = v_request.id returning * into v_request;
  insert into grau_self_check_in_private.request_events(request_id, gym_id, class_id, student_id, event_type, actor_user_id, detail) values (v_request.id, v_request.gym_id, v_request.class_id, v_request.student_id, v_outcome, auth.uid(), v_reason);
  return query select v_request.student_id, v_request.id, v_request.state, v_request.reason;
end;
$$;

create function public.staff_self_check_in_resolve_request(p_request_id bigint, p_decision text, p_resolution_key uuid)
returns table (student_id bigint, request_id bigint, state text, reason text)
language sql
volatile
security definer
set search_path = pg_catalog, public, grau_self_check_in_private, pg_temp
as $$ select * from grau_self_check_in_private.resolve_request(p_request_id, p_decision, p_resolution_key); $$;

create function public.staff_self_check_in_bulk_approve(p_class_id bigint, p_request_ids bigint[], p_resolution_key uuid)
returns table (student_id bigint, request_id bigint, state text, reason text)
language plpgsql
security definer
set search_path = pg_catalog, public, grau_self_check_in_private, pg_temp
as $$
declare
  v_request_id bigint;
  v_gym_id bigint;
  v_result record;
  v_request_ids bigint[];
  v_existing_bulk grau_self_check_in_private.bulk_resolution_batches%rowtype;
  v_has_pending boolean := false;
begin
  if p_request_ids is null or cardinality(p_request_ids) = 0 or p_resolution_key is null then raise exception 'At least one request and a retry key are required.' using errcode = '22023'; end if;
  if exists (select 1 from unnest(p_request_ids) as request_input(request_id) where request_input.request_id is null or request_input.request_id <= 0) then
    raise exception 'Request IDs must be positive.' using errcode = '22023';
  end if;
  if cardinality(p_request_ids) <> (select count(distinct request_input.request_id) from unnest(p_request_ids) as request_input(request_id)) then
    raise exception 'Duplicate request IDs are not allowed.' using errcode = '22023';
  end if;
  select array_agg(request_input.request_id order by request_input.request_id)
  into v_request_ids
  from unnest(p_request_ids) as request_input(request_id);
  select c.gym_id into v_gym_id from public.classes as c where c.id = p_class_id;
  if v_gym_id is null then raise exception 'Class was not found.' using errcode = '42501'; end if;
  perform grau_self_check_in_private.require_rollout(v_gym_id);
  perform grau_self_check_in_private.require_active_staff(v_gym_id);

  -- A committed, exact successful bulk retry is read-only. It may return the
  -- original results after the class closes, but can never create attendance
  -- or audit events. New keys continue through live class validation below.
  select * into v_existing_bulk
  from grau_self_check_in_private.bulk_resolution_batches
  where resolution_key = p_resolution_key
  for update;

  if found then
    if v_existing_bulk.staff_user_id <> auth.uid()
       or v_existing_bulk.gym_id <> v_gym_id
       or v_existing_bulk.class_id <> p_class_id
       or v_existing_bulk.request_ids is distinct from v_request_ids then
      raise exception 'Bulk retry key does not match this approval selection.' using errcode = '22023';
    end if;

    if cardinality(v_request_ids)
       <> (select count(*) from grau_self_check_in_private.requests where gym_id = v_gym_id and class_id = p_class_id and id = any(v_request_ids)) then
      raise exception 'Every selected request must belong to this class.' using errcode = '22023';
    end if;

    for v_request_id in select request_input.request_id from unnest(v_request_ids) as request_input(request_id) order by request_input.request_id loop
      select r.id, r.state, r.resolution_key, r.resolution_decision
      into v_result
      from grau_self_check_in_private.requests as r
      where r.id = v_request_id and r.gym_id = v_gym_id and r.class_id = p_class_id
      for update;
      if v_result.state <> 'approved'
         or v_result.resolution_key is distinct from p_resolution_key
         or v_result.resolution_decision <> 'approve' then
        raise exception 'Bulk retry key is not a completed successful approval.' using errcode = '22023';
      end if;
    end loop;

    return query
    select r.student_id, r.id, r.state, r.reason
    from grau_self_check_in_private.requests as r
    where r.gym_id = v_gym_id and r.class_id = p_class_id and r.id = any(v_request_ids)
    order by r.id;
    return;
  end if;

  -- The class is locked and validated before the bulk UUID is claimed. This
  -- New keys therefore use the same fail-closed lifecycle contract.
  perform grau_self_check_in_private.lock_and_validate_class(v_gym_id, p_class_id);
  perform grau_self_check_in_private.claim_bulk_resolution_batch(
    v_gym_id,
    p_class_id,
    v_request_ids,
    p_resolution_key
  );
  if cardinality(v_request_ids)
     <> (select count(*) from grau_self_check_in_private.requests where gym_id = v_gym_id and class_id = p_class_id and id = any(v_request_ids)) then
    raise exception 'Every selected request must belong to this class.' using errcode = '22023';
  end if;

  -- Lock every selected request before the first approval. A request already
  -- resolved by the same approval key is a retry; any other prior resolution
  -- fails the whole bulk operation rather than producing a partial batch.
  for v_request_id in select request_input.request_id from unnest(v_request_ids) as request_input(request_id) order by request_input.request_id loop
    select r.id, r.state, r.resolution_key, r.resolution_decision
    into v_result
    from grau_self_check_in_private.requests as r
    where r.id = v_request_id and r.gym_id = v_gym_id and r.class_id = p_class_id
    for update;
    if v_result.state <> 'pending'
       and (v_result.resolution_key is distinct from p_resolution_key or v_result.resolution_decision <> 'approve') then
      raise exception 'A selected request was already resolved with a different decision or retry key.' using errcode = '22023';
    end if;
    if v_result.state = 'pending' then
      v_has_pending := true;
    end if;
  end loop;

  if not v_has_pending then
    return query
    select r.student_id, r.id, r.state, r.reason
    from grau_self_check_in_private.requests as r
    where r.gym_id = v_gym_id and r.class_id = p_class_id and r.id = any(v_request_ids)
    order by r.id;
    return;
  end if;

  -- A single PostgreSQL function call is transactional. Each result must be
  -- approved; a duplicate-attendance or eligibility outcome raises below and
  -- rolls back every approval performed earlier in this bulk operation.
  for v_request_id in select request_input.request_id from unnest(v_request_ids) as request_input(request_id) order by request_input.request_id loop
    select * into v_result from grau_self_check_in_private.resolve_request(v_request_id, 'approve', p_resolution_key);
    if v_result.state <> 'approved' then
      raise exception 'Bulk approval did not approve every selected request.' using errcode = 'P0001';
    end if;
  end loop;
  return query
  select r.student_id, r.id, r.state, r.reason
  from grau_self_check_in_private.requests as r
  where r.gym_id = v_gym_id and r.class_id = p_class_id and r.id = any(v_request_ids)
  order by r.id;
end;
$$;

revoke all on all tables in schema grau_self_check_in_private from public, anon, authenticated, service_role;
revoke all on all sequences in schema grau_self_check_in_private from public, anon, authenticated, service_role;
revoke all on all functions in schema grau_self_check_in_private from public, anon, authenticated, service_role;
revoke all on function public.family_self_check_in_available_classes(bigint) from public, anon, authenticated, service_role;
revoke all on function public.family_self_check_in_eligible_students(bigint, bigint) from public, anon, authenticated, service_role;
revoke all on function public.family_self_check_in_request(bigint, bigint, bigint[], uuid) from public, anon, authenticated, service_role;
revoke all on function public.staff_self_check_in_list_requests(bigint) from public, anon, authenticated, service_role;
revoke all on function public.staff_self_check_in_resolve_request(bigint, text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.staff_self_check_in_bulk_approve(bigint, bigint[], uuid) from public, anon, authenticated, service_role;
grant execute on function public.family_self_check_in_available_classes(bigint) to authenticated;
grant execute on function public.family_self_check_in_eligible_students(bigint, bigint) to authenticated;
grant execute on function public.family_self_check_in_request(bigint, bigint, bigint[], uuid) to authenticated;
grant execute on function public.staff_self_check_in_list_requests(bigint) to authenticated;
grant execute on function public.staff_self_check_in_resolve_request(bigint, text, uuid) to authenticated;
grant execute on function public.staff_self_check_in_bulk_approve(bigint, bigint[], uuid) to authenticated;

commit;
