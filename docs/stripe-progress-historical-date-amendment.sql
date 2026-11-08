-- REVIEW ONLY — DO NOT APPLY UNTIL TEST VERIFICATION IS COMPLETE.
-- This is an additive amendment to the existing stripe-progress migration.
-- It does not alter students, attendance, classes, baselines, Promotions, or
-- record_student_promotion. App-recorded promotion_effective_at values remain
-- the exact server timestamps written by the existing promotion RPC.

begin;

do $$
begin
  if to_regclass('public.students') is null
    or to_regclass('public.gym_settings') is null
    or to_regclass('public.gym_staff') is null
    or to_regclass('public.classes') is null
    or to_regclass('public.attendance') is null
    or to_regclass('public."Promotions"') is null
    or to_regclass('public.student_stripe_progress_baselines') is null then
    raise exception 'Historical stripe progress requires the existing students, gym_settings, gym_staff, classes, attendance, Promotions, and baseline tables.';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'students'
      and column_name = 'studentId' and data_type = 'bigint'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'students'
      and column_name in ('gym_id', 'belt_rank', 'stripes', 'promotion_track')
    group by table_schema, table_name
    having count(*) = 4
  ) then
    raise exception 'students must expose bigint "studentId", gym_id, belt_rank, stripes, and promotion_track.';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'gym_settings'
      and column_name in ('id', 'time_zone')
    group by table_schema, table_name
    having count(*) = 2
  ) then
    raise exception 'gym_settings must expose id and time_zone.';
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
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'classes'
      and column_name = 'class_date' and data_type = 'timestamp with time zone'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'classes'
      and column_name in ('id', 'gym_id', 'start_time')
    group by table_schema, table_name
    having count(*) = 3
  ) then
    raise exception 'classes must expose id, gym_id, timestamptz class_date, and start_time.';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'attendance'
      and column_name in ('student_id', 'class_id', 'gym_id', 'stripe_progress_classification')
    group by table_schema, table_name
    having count(*) = 4
  ) then
    raise exception 'attendance must expose student_id, class_id, gym_id, and stripe_progress_classification.';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'Promotions'
      and column_name in ('student_id', 'gym_id', 'new_belt', 'new_stripes', 'promotion_track_at_promotion', 'promotion_effective_at')
    group by table_schema, table_name
    having count(*) = 6
  ) then
    raise exception 'Promotions must expose the existing stripe-progress promotion snapshot columns.';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.students'::regclass
      and conname = 'students_student_id_gym_id_key'
      and contype = 'u'
      and pg_get_constraintdef(oid) = 'UNIQUE ("studentId", gym_id)'
  ) then
    raise exception 'The existing students_student_id_gym_id_key constraint is required and will not be changed.';
  end if;

  if to_regclass('public.student_historical_promotion_boundaries') is not null
    or to_regprocedure('public.confirm_student_historical_promotion_date(bigint,date,text)') is not null
    or to_regprocedure('public.get_gym_stripe_progress_context()') is not null then
    raise exception 'Historical stripe-progress objects already exist. Stop and review their deployed definitions; this amendment never replaces them.';
  end if;
end
$$;

create table public.student_historical_promotion_boundaries (
  id bigint generated always as identity primary key,
  gym_id bigint not null references public.gym_settings(id) on delete restrict,
  student_id bigint not null,
  last_promotion_date date not null,
  time_zone_at_confirmation text not null check (length(btrim(time_zone_at_confirmation)) > 0),
  belt_rank_at_confirmation text not null check (length(btrim(belt_rank_at_confirmation)) > 0),
  stripes_at_confirmation integer not null check (stripes_at_confirmation between 0 and 4),
  promotion_track_at_confirmation text not null check (promotion_track_at_confirmation in ('kids', 'adults')),
  confirmation_note text not null check (length(btrim(confirmation_note)) >= 3),
  confirmed_by uuid not null,
  confirmed_at timestamptz not null default now(),
  constraint student_historical_promotion_boundaries_student_gym_fkey
    foreign key (student_id, gym_id)
    references public.students("studentId", gym_id) on delete restrict,
  constraint student_historical_promotion_boundaries_snapshot_key
    unique (gym_id, student_id, last_promotion_date, belt_rank_at_confirmation, stripes_at_confirmation, promotion_track_at_confirmation)
);

create index student_historical_promotion_boundaries_reader_idx
  on public.student_historical_promotion_boundaries
  (gym_id, student_id, belt_rank_at_confirmation, stripes_at_confirmation, promotion_track_at_confirmation, last_promotion_date desc, confirmed_at desc);

alter table public.student_historical_promotion_boundaries enable row level security;

create function public.reject_historical_promotion_boundary_mutation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  raise exception 'Historical promotion boundaries are append-only.';
end;
$$;

create trigger student_historical_promotion_boundaries_immutable
before update or delete on public.student_historical_promotion_boundaries
for each row execute function public.reject_historical_promotion_boundary_mutation();

create function public.confirm_student_historical_promotion_date(
  p_student_id bigint,
  p_last_promotion_date date,
  p_confirmation_note text
)
returns public.student_historical_promotion_boundaries
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_gym_id bigint;
  v_membership_count integer;
  v_timezone text;
  v_student public.students%rowtype;
  v_boundary public.student_historical_promotion_boundaries%rowtype;
begin
  if p_student_id is null or p_last_promotion_date is null or p_confirmation_note is null
    or length(btrim(p_confirmation_note)) < 3 then
    raise exception 'A member, last promotion date, and confirmation note are required.';
  end if;

  select min(staff.gym_id), count(*)
    into v_gym_id, v_membership_count
  from public.gym_staff staff
  where staff.user_id = auth.uid()
    and staff.is_active = true
    and staff.role in ('admin', 'coach');

  if v_membership_count <> 1 or v_gym_id is null then
    raise exception 'Exactly one active gym administrator or coach membership is required.';
  end if;

  select settings.time_zone into v_timezone
  from public.gym_settings settings
  where settings.id = v_gym_id;
  if v_timezone is null or not exists (select 1 from pg_timezone_names where name = v_timezone) then
    raise exception 'This gym must have a valid configured time_zone before a historical date can be confirmed.';
  end if;
  if p_last_promotion_date > (now() at time zone v_timezone)::date then
    raise exception 'The last promotion date cannot be in this gym''s future.';
  end if;

  select * into v_student
  from public.students
  where "studentId" = p_student_id and gym_id = v_gym_id
  for update;
  if not found then
    raise exception 'The selected member does not belong to this gym.';
  end if;
  if v_student.promotion_track is null
    or lower(btrim(v_student.promotion_track)) not in ('kids', 'adults') then
    raise exception 'The member must have an explicit Kids or Adults promotion track before a historical date can be confirmed.';
  end if;
  if v_student.belt_rank is null or length(btrim(v_student.belt_rank)) = 0
    or v_student.stripes is null or v_student.stripes not between 0 and 4 then
    raise exception 'The member must have a valid belt rank and stripe count before a historical date can be confirmed.';
  end if;

  -- An app-recorded promotion is authoritative for this same rank/track snapshot.
  -- Its effective timestamp is never rewritten or converted in this amendment.
  if exists (
    select 1
    from public."Promotions" promotion
    where promotion.gym_id = v_gym_id
      and promotion.student_id = p_student_id
      and promotion.promotion_effective_at is not null
      and lower(btrim(promotion.new_belt)) = lower(btrim(v_student.belt_rank))
      and promotion.new_stripes = v_student.stripes
      and lower(btrim(promotion.promotion_track_at_promotion)) = lower(btrim(v_student.promotion_track))
      and promotion.promotion_effective_at >= (p_last_promotion_date::timestamp at time zone v_timezone)
  ) then
    raise exception 'A same-rank app-recorded promotion is already on or after this historical date; it remains the counting boundary.';
  end if;

  select * into v_boundary
  from public.student_historical_promotion_boundaries boundary
  where boundary.gym_id = v_gym_id
    and boundary.student_id = p_student_id
    and boundary.last_promotion_date = p_last_promotion_date
    and lower(btrim(boundary.belt_rank_at_confirmation)) = lower(btrim(v_student.belt_rank))
    and boundary.stripes_at_confirmation = v_student.stripes
    and boundary.promotion_track_at_confirmation = lower(btrim(v_student.promotion_track));
  if found then
    if v_boundary.confirmed_by = auth.uid()
      and v_boundary.confirmation_note = btrim(p_confirmation_note) then
      return v_boundary;
    end if;
    raise exception 'A historical boundary already exists for this exact member rank, stripes, track, and date; submit a distinct correction date rather than overwriting it.';
  end if;

  -- Corrections are append-only: either an earlier or later date may be
  -- confirmed, while the reader selects the newest explicit confirmation.

  insert into public.student_historical_promotion_boundaries (
    gym_id, student_id, last_promotion_date, time_zone_at_confirmation,
    belt_rank_at_confirmation, stripes_at_confirmation, promotion_track_at_confirmation,
    confirmation_note, confirmed_by
  ) values (
    v_gym_id, p_student_id, p_last_promotion_date, v_timezone,
    lower(btrim(v_student.belt_rank)), v_student.stripes, lower(btrim(v_student.promotion_track)),
    btrim(p_confirmation_note), auth.uid()
  ) returning * into v_boundary;

  return v_boundary;
end;
$$;

create function public.get_gym_stripe_progress_context()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_gym_id bigint;
  v_membership_count integer;
  v_timezone text;
begin
  select min(staff.gym_id), count(*)
    into v_gym_id, v_membership_count
  from public.gym_staff staff
  where staff.user_id = auth.uid()
    and staff.is_active = true
    and staff.role in ('admin', 'coach');
  if v_membership_count <> 1 or v_gym_id is null then
    raise exception 'Exactly one active gym administrator or coach membership is required.';
  end if;

  select settings.time_zone into v_timezone
  from public.gym_settings settings
  where settings.id = v_gym_id;
  if v_timezone is null or not exists (select 1 from pg_timezone_names where name = v_timezone) then
    raise exception 'This gym must have a valid configured time_zone before stripe progress can be calculated.';
  end if;

  return jsonb_build_object(
    'classes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', scheduled_class.id,
        'class_date', scheduled_class.class_date,
        'scheduled_class_day', (scheduled_class.class_date at time zone 'UTC')::date,
        -- The current app save contract writes the selected calendar date as
        -- YYYY-MM-DDT00:00:00+00:00 and keeps local start_time separately.
        -- Recover that UTC calendar date, add start_time, then interpret the
        -- resulting local timestamp once in the configured gym timezone.
        'scheduled_start_at', ((scheduled_class.class_date at time zone 'UTC')::date + scheduled_class.start_time) at time zone v_timezone
      ) order by scheduled_class.id)
      from public.classes scheduled_class
      where scheduled_class.gym_id = v_gym_id
        and scheduled_class.class_date is not null
        and scheduled_class.start_time is not null
        and scheduled_class.class_date = (date_trunc('day', scheduled_class.class_date at time zone 'UTC') at time zone 'UTC')
    ), '[]'::jsonb),
    'class_contract_exceptions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', scheduled_class.id,
        'class_date', scheduled_class.class_date
      ) order by scheduled_class.id)
      from public.classes scheduled_class
      where scheduled_class.gym_id = v_gym_id
        and (
          scheduled_class.class_date is null
          or scheduled_class.start_time is null
          or scheduled_class.class_date <> (date_trunc('day', scheduled_class.class_date at time zone 'UTC') at time zone 'UTC')
        )
    ), '[]'::jsonb),
    'historical_boundaries', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', boundary.id,
        'student_id', boundary.student_id,
        'last_promotion_date', boundary.last_promotion_date,
        'time_zone_at_confirmation', boundary.time_zone_at_confirmation,
        'confirmed_at', boundary.confirmed_at,
        'belt_rank_at_confirmation', boundary.belt_rank_at_confirmation,
        'stripes_at_confirmation', boundary.stripes_at_confirmation,
        'promotion_track_at_confirmation', boundary.promotion_track_at_confirmation
      ) order by boundary.student_id, boundary.confirmed_at desc, boundary.id desc)
      from public.student_historical_promotion_boundaries boundary
      where boundary.gym_id = v_gym_id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on table public.student_historical_promotion_boundaries from public, anon, authenticated;
revoke all on sequence public.student_historical_promotion_boundaries_id_seq from public, anon, authenticated;
revoke all on function public.reject_historical_promotion_boundary_mutation() from public, anon, authenticated;
revoke all on function public.confirm_student_historical_promotion_date(bigint, date, text) from public, anon;
revoke all on function public.get_gym_stripe_progress_context() from public, anon;
grant execute on function public.confirm_student_historical_promotion_date(bigint, date, text) to authenticated;
grant execute on function public.get_gym_stripe_progress_context() to authenticated;

commit;
