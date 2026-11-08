-- SUPERSEDED — DO NOT DEPLOY.
--
-- Replaced by stripe-progress-class-567-deployment.sql. This older draft
-- permits a broader category of historical null-start classes and includes a
-- student-specific preflight. It is retained only as review history.
--
-- REVIEW ONLY — DO NOT APPLY UNTIL MAIN SUPABASE REVIEW IS COMPLETE.
--
-- This narrowly amends get_gym_stripe_progress_context(). It does not update
-- classes, attendance, students, promotions, baselines, or boundaries.
--
-- A past historical class may have an unknown start_time only when it has
-- saved qualifying attendance. Its verified UTC calendar day remains usable
-- for a historical date boundary. Its scheduled_start_at remains null, so it
-- is never counted across an exact promotion_effective_at timestamp boundary.

begin;

do $$
begin
  if to_regclass('public.classes') is null
    or to_regclass('public.attendance') is null
    or to_regclass('public.gym_settings') is null
    or to_regclass('public.gym_staff') is null then
    raise exception 'The existing classes, attendance, gym_settings, and gym_staff tables are required.';
  end if;

  if to_regprocedure('public.get_gym_stripe_progress_context()') is null then
    raise exception 'The existing get_gym_stripe_progress_context() RPC is required.';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'classes'
      and column_name in ('id', 'gym_id', 'class_date', 'start_time')
    group by table_schema, table_name
    having count(*) = 4
  ) or not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'attendance'
      and column_name in ('student_id', 'gym_id', 'class_id', 'stripe_progress_classification')
    group by table_schema, table_name
    having count(*) = 4
  ) then
    raise exception 'The existing class and attendance stripe-progress columns are required.';
  end if;

  -- Review-only assertion for the reported historical record. No data is
  -- changed; a mismatch means the facts should be rechecked before applying.
  if not exists (
    select 1
    from public.classes scheduled_class
    where scheduled_class.id = 567
      and scheduled_class.gym_id = 4
      and scheduled_class.class_date = '2026-09-20 00:00:00+00'::timestamptz
      and scheduled_class.start_time is null
  ) then
    raise exception 'Expected gym 4 class 567 with 2026-09-20 UTC-midnight class_date and null start_time was not found.';
  end if;

  if not exists (
    select 1
    from public.attendance attendance
    where attendance.gym_id = 4
      and attendance.class_id = 567
      and attendance.student_id = 47
      and attendance.stripe_progress_classification = 'qualifying'
  ) then
    raise exception 'Expected qualifying attendance for student 47 in gym 4 class 567 was not found.';
  end if;
end
$$;

create or replace function public.get_gym_stripe_progress_context()
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
        -- A missing historical start time deliberately stays null. The client
        -- can therefore use the calendar day for a historical-date boundary,
        -- but cannot count this class across a timestamp boundary.
        'scheduled_start_at', case
          when scheduled_class.start_time is null then null
          else ((scheduled_class.class_date at time zone 'UTC')::date + scheduled_class.start_time) at time zone v_timezone
        end
      ) order by scheduled_class.id)
      from public.classes scheduled_class
      where scheduled_class.gym_id = v_gym_id
        and scheduled_class.class_date is not null
        and scheduled_class.class_date = (date_trunc('day', scheduled_class.class_date at time zone 'UTC') at time zone 'UTC')
        and (
          scheduled_class.start_time is not null
          or exists (
            select 1
            from public.attendance historical_attendance
            where historical_attendance.gym_id = scheduled_class.gym_id
              and historical_attendance.class_id = scheduled_class.id
              and historical_attendance.stripe_progress_classification = 'qualifying'
              and scheduled_class.class_date < (date_trunc('day', now() at time zone 'UTC') at time zone 'UTC')
          )
        )
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
          or scheduled_class.class_date <> (date_trunc('day', scheduled_class.class_date at time zone 'UTC') at time zone 'UTC')
          or (
            scheduled_class.start_time is null
            and not exists (
              select 1
              from public.attendance historical_attendance
              where historical_attendance.gym_id = scheduled_class.gym_id
                and historical_attendance.class_id = scheduled_class.id
                and historical_attendance.stripe_progress_classification = 'qualifying'
                and scheduled_class.class_date < (date_trunc('day', now() at time zone 'UTC') at time zone 'UTC')
            )
          )
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

revoke all on function public.get_gym_stripe_progress_context() from public, anon;
grant execute on function public.get_gym_stripe_progress_context() to authenticated;

commit;
