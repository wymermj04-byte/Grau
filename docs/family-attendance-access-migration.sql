-- REVIEW ONLY — DO NOT APPLY UNTIL THE INVENTORY AND STAGING TESTS ARE REVIEWED.
--
-- This is additive. It preserves existing attendance/classes/staff policies and
-- grants no direct attendance-table privilege to family accounts. The only new
-- family read surface is my_linked_member_attendance(student_id).

begin;

do $$
begin
  if to_regclass('public.attendance') is null
    or to_regclass('public.classes') is null
    or to_regclass('public.gym_settings') is null
    or to_regclass('public.member_account_links') is null then
    raise exception 'Family attendance requires existing attendance, classes, gym_settings, and member_account_links tables.';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'attendance'
      and column_name in ('student_id', 'gym_id', 'class_id', 'class_type', 'check_in_date')
    group by table_schema, table_name
    having count(*) = 5
  ) then
    raise exception 'attendance must expose student_id, gym_id, class_id, class_type, and check_in_date.';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'attendance'
      and column_name = 'class_id' and is_nullable = 'YES'
  ) then
    raise exception 'attendance.class_id must retain its nullable Open Mat contract.';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'attendance'
      and column_name = 'check_in_date' and data_type = 'timestamp with time zone'
  ) then
    raise exception 'attendance.check_in_date must be timestamptz for gym-local calendar-date conversion.';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'classes'
      and column_name = 'class_date' and data_type = 'timestamp with time zone'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'classes'
      and column_name in ('id', 'gym_id', 'class_name')
    group by table_schema, table_name
    having count(*) = 3
  ) then
    raise exception 'classes must expose id, gym_id, class_name, and timestamptz class_date.';
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
    where table_schema = 'public' and table_name = 'member_account_links'
      and column_name in ('student_id', 'gym_id', 'user_id', 'status')
    group by table_schema, table_name
    having count(*) = 4
  ) then
    raise exception 'member_account_links must expose student_id, gym_id, user_id, and status.';
  end if;

  if to_regprocedure('public.my_linked_member_attendance(bigint)') is not null then
    raise exception 'my_linked_member_attendance(bigint) already exists. Stop and review its deployed definition; this migration never replaces it.';
  end if;
end
$$;

create function public.my_linked_member_attendance(p_student_id bigint)
returns table (
  class_name text,
  class_date date,
  attendance_status text
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if auth.uid() is null or not exists (
    select 1
    from public.member_account_links link
    where link.user_id = auth.uid()
      and link.status = 'approved'
      and link.student_id = p_student_id
  ) then
    raise exception 'You do not have access to this member attendance.' using errcode = '42501';
  end if;

  return query
  select
    case
      when attendance.class_id is null then attendance.class_type::text
      when scheduled_class.id is null then attendance.class_type::text
      else scheduled_class.class_name::text
    end as class_name,
    case
      when attendance.class_id is not null and scheduled_class.class_date is not null
        then (scheduled_class.class_date at time zone 'UTC')::date
      when attendance.check_in_date is not null
        then (attendance.check_in_date at time zone linked_gym.time_zone)::date
      else null::date
    end as class_date,
    'checked_in'::text as attendance_status
  from public.member_account_links link
  join public.gym_settings linked_gym
    on linked_gym.id = link.gym_id
  join public.attendance attendance
    on attendance.student_id = link.student_id
   and attendance.gym_id = link.gym_id
  left join public.classes scheduled_class
    on scheduled_class.id = attendance.class_id
   and scheduled_class.gym_id = attendance.gym_id
  where link.user_id = auth.uid()
    and link.status = 'approved'
    and link.student_id = p_student_id
    and (attendance.class_id is null or scheduled_class.id is not null)
  order by
    case
      when attendance.class_id is not null and scheduled_class.class_date is not null
        then (scheduled_class.class_date at time zone 'UTC')::date
      when attendance.check_in_date is not null
        then (attendance.check_in_date at time zone linked_gym.time_zone)::date
      else null::date
    end desc nulls last,
    attendance.check_in_date desc nulls last;
end;
$$;

-- Do not grant attendance or classes table access here. Existing staff grants
-- and policies are untouched; family callers receive only this projected RPC.
revoke all on function public.my_linked_member_attendance(bigint) from public, anon;
grant execute on function public.my_linked_member_attendance(bigint) to authenticated;

commit;
