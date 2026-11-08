-- STAGING ONLY — rollback-contained checks for the reviewed family attendance RPC.
-- Requires the installed member-account-links migration and two existing
-- nonstaff auth users. This script creates no auth users and rolls back links.

rollback;
begin;

do $test$
declare
  v_admin uuid;
  v_family uuid;
  v_other_family uuid;
  v_gym_id bigint;
  v_other_gym_id bigint;
  v_gym_time_zone text;
  v_other_gym_name text := '__family-attendance-test-gym-' || gen_random_uuid()::text;
  v_student_id bigint;
  v_empty_student_id bigint;
  v_other_student_id bigint;
  v_cross_gym_student_id bigint;
  v_scheduled_class_id bigint;
  v_cross_gym_class_id bigint;
  v_gym_insert_columns text;
  v_gym_select_columns text;
  v_student_insert_columns text;
  v_student_select_columns text;
  v_gym_id_is_identity text;
  v_gym_id_default text;
  v_student_id_is_identity text;
  v_student_id_default text;
  v_nonstaff_users uuid[];
  v_fallback_name text;
  v_fallback_date date;
  v_scheduled_name text;
  v_scheduled_date date;
  v_timezone_fixture_name text := '__family-attendance-timezone-' || gen_random_uuid()::text;
  v_scheduled_fixture_name text := '__family-attendance-scheduled-' || gen_random_uuid()::text;
  v_mismatch_fixture_name text := '__family-attendance-mismatch-' || gen_random_uuid()::text;
  v_timezone_fixture_at timestamptz := '2026-01-01 00:30:00+00'::timestamptz;
  v_scheduled_fixture_at timestamptz := '2026-01-15 18:30:00+00'::timestamptz;
  v_timezone_expected_date date;
  v_utc_session_date date;
  v_kiritimati_session_date date;
  v_mismatch_row_inserted boolean := false;
  v_count bigint;
  v_previous_date date;
  v_seen_null_date boolean := false;
  v_result record;
  v_link public.member_account_links%rowtype;
begin
  select staff.gym_id, staff.user_id
    into v_gym_id, v_admin
  from public.gym_staff staff
  where staff.is_active = true
    and staff.role = 'admin'
    and 3 <= (
      select count(*)
      from public.students student
      where student.gym_id = staff.gym_id
    )
  order by staff.gym_id, staff.user_id
  limit 1;

  if v_admin is null then
    raise exception 'FAIL setup: staging needs an active admin gym with at least three students. The script creates its rollback-only second gym, student, class, and attendance fixtures.';
  end if;

  select settings.time_zone into v_gym_time_zone
  from public.gym_settings settings
  where settings.id = v_gym_id;
  if v_gym_time_zone is null or btrim(v_gym_time_zone) = '' then
    raise exception 'FAIL setup: selected admin gym needs a configured time zone.';
  end if;
  v_timezone_expected_date := (v_timezone_fixture_at at time zone v_gym_time_zone)::date;

  select array_agg(user_info.id order by user_info.id)
    into v_nonstaff_users
  from (
    select user_info.id
    from auth.users user_info
    where not exists (
      select 1 from public.gym_staff staff
      where staff.user_id = user_info.id and staff.is_active = true
    )
    order by user_info.id
    limit 2
  ) user_info;

  if coalesce(cardinality(v_nonstaff_users), 0) < 2 then
    raise exception 'FAIL setup: staging needs two existing nonstaff auth users; this script creates none.';
  end if;
  v_family := v_nonstaff_users[1];
  v_other_family := v_nonstaff_users[2];

  select student."studentId"
    into v_student_id
  from public.students student
  where student.gym_id = v_gym_id
  order by student."studentId"
  limit 1;

  select student."studentId" into v_empty_student_id
  from public.students student
  where student.gym_id = v_gym_id
    and student."studentId" <> v_student_id
    and not exists (
      select 1 from public.attendance attendance
      where attendance.gym_id = student.gym_id
        and attendance.student_id = student."studentId"
    )
  order by student."studentId"
  limit 1;

  select student."studentId" into v_other_student_id
  from public.students student
  where student.gym_id = v_gym_id
    and student."studentId" not in (v_student_id, v_empty_student_id)
  order by student."studentId"
  limit 1;

  if v_student_id is null or v_empty_student_id is null or v_other_student_id is null then
    raise exception 'FAIL setup: staging needs an attendance-free student and two other students in the admin gym. This script creates no auth users.';
  end if;

  -- These transaction-local fixtures use the existing TEST gyms and students.
  -- They are all removed by the final ROLLBACK.
  v_fallback_name := v_timezone_fixture_name;
  v_fallback_date := (v_timezone_fixture_at at time zone v_gym_time_zone)::date;
  v_scheduled_name := v_scheduled_fixture_name;
  v_scheduled_date := (v_scheduled_fixture_at at time zone 'UTC')::date;

  -- Inspect identity/default behavior before omitting generated primary keys.
  select column_info.is_identity, column_info.column_default
    into v_gym_id_is_identity, v_gym_id_default
  from information_schema.columns column_info
  where column_info.table_schema = 'public'
    and column_info.table_name = 'gym_settings'
    and column_info.column_name = 'id';
  select column_info.is_identity, column_info.column_default
    into v_student_id_is_identity, v_student_id_default
  from information_schema.columns column_info
  where column_info.table_schema = 'public'
    and column_info.table_name = 'students'
    and column_info.column_name = 'studentId';
  if v_gym_id_is_identity is null
    or (v_gym_id_is_identity = 'NO' and v_gym_id_default is null) then
    raise exception 'FAIL setup: public.gym_settings.id must be an identity column or have a default before this rollback-only fixture can create a second gym.';
  end if;
  if v_student_id_is_identity is null
    or (v_student_id_is_identity = 'NO' and v_student_id_default is null) then
    raise exception 'FAIL setup: public.students."studentId" must be an identity column or have a default before this rollback-only fixture can create a second-gym student.';
  end if;
  if not exists (
    select 1 from information_schema.columns column_info
    where column_info.table_schema = 'public'
      and column_info.table_name = 'gym_settings'
      and column_info.column_name = 'gym_name'
      and column_info.data_type = 'text'
  ) then
    raise exception 'FAIL setup: public.gym_settings must expose text gym_name so the temporary gym can use a unique name.';
  end if;

  -- Refuse to clone a row if an unknown global-unique value would be copied.
  if exists (
    select 1
    from pg_index index_info
    where index_info.indrelid = 'public.gym_settings'::regclass
      and index_info.indisunique
      and exists (
        select 1
        from unnest(index_info.indkey) as key_info(attnum)
        left join pg_attribute attribute_info
          on attribute_info.attrelid = index_info.indrelid
         and attribute_info.attnum = key_info.attnum
        where coalesce(attribute_info.attname, '') not in ('id', 'gym_name')
      )
  ) then
    raise exception 'FAIL setup: public.gym_settings has a global unique key other than id/gym_name. Review its required value before cloning a temporary gym.';
  end if;
  if exists (
    select 1
    from pg_index index_info
    where index_info.indrelid = 'public.students'::regclass
      and index_info.indisunique
      and not exists (
        select 1
        from unnest(index_info.indkey) as key_info(attnum)
        join pg_attribute attribute_info
          on attribute_info.attrelid = index_info.indrelid
         and attribute_info.attnum = key_info.attnum
        where attribute_info.attname = 'gym_id'
      )
      and exists (
        select 1
        from unnest(index_info.indkey) as key_info(attnum)
        left join pg_attribute attribute_info
          on attribute_info.attrelid = index_info.indrelid
         and attribute_info.attnum = key_info.attnum
        where coalesce(attribute_info.attname, '') <> 'studentId'
      )
  ) then
    raise exception 'FAIL setup: public.students has a global unique key other than studentId. Review its required value before cloning a temporary student.';
  end if;

  -- Build explicit target lists from the actual deployed definitions. This
  -- copies every required source value and intentionally omits only generated
  -- primary keys; no table defaults or constraints are disabled.
  select
    string_agg(format('%I', column_info.column_name), ', ' order by column_info.ordinal_position),
    string_agg(format('cloned.%I', column_info.column_name), ', ' order by column_info.ordinal_position)
    into v_gym_insert_columns, v_gym_select_columns
  from information_schema.columns column_info
  where column_info.table_schema = 'public'
    and column_info.table_name = 'gym_settings'
    and column_info.column_name <> 'id'
    and column_info.is_identity = 'NO'
    and column_info.is_generated = 'NEVER';
  select
    string_agg(format('%I', column_info.column_name), ', ' order by column_info.ordinal_position),
    string_agg(format('cloned.%I', column_info.column_name), ', ' order by column_info.ordinal_position)
    into v_student_insert_columns, v_student_select_columns
  from information_schema.columns column_info
  where column_info.table_schema = 'public'
    and column_info.table_name = 'students'
    and column_info.column_name <> 'studentId'
    and column_info.is_identity = 'NO'
    and column_info.is_generated = 'NEVER';
  if v_gym_insert_columns is null or v_student_insert_columns is null then
    raise exception 'FAIL setup: unable to derive writable gym_settings/students fixture columns from the deployed schema.';
  end if;

  execute format(
    'insert into public.gym_settings (%1$s) select %2$s from public.gym_settings source cross join lateral jsonb_populate_record(null::public.gym_settings, jsonb_set(to_jsonb(source), ''{gym_name}'', to_jsonb($1::text), true)) as cloned where source.id = $2 returning id',
    v_gym_insert_columns,
    v_gym_select_columns
  ) into v_other_gym_id using v_other_gym_name, v_gym_id;

  execute format(
    'insert into public.students (%1$s) select %2$s from public.students source cross join lateral jsonb_populate_record(null::public.students, jsonb_set(to_jsonb(source), ''{gym_id}'', to_jsonb($1::bigint), true)) as cloned where source.gym_id = $2 and source."studentId" = $3 returning "studentId"',
    v_student_insert_columns,
    v_student_select_columns
  ) into v_cross_gym_student_id using v_other_gym_id, v_gym_id, v_student_id;

  insert into public.classes (
    class_name, coach_name, class_date, start_time, end_time, max_students,
    class_type, notes, is_active, status, gym_id
  ) values (
    v_scheduled_name, 'Family attendance TEST', '2026-01-15 00:00:00+00',
    '18:00:00', '19:00:00', 20, 'Fundamentals', '', false, 'Scheduled', v_gym_id
  ) returning id into v_scheduled_class_id;

  insert into public.classes (
    class_name, coach_name, class_date, start_time, end_time, max_students,
    class_type, notes, is_active, status, gym_id
  ) values (
    '__family-attendance-cross-gym-' || gen_random_uuid()::text,
    'Family attendance TEST', '2026-01-16 00:00:00+00',
    '18:00:00', '19:00:00', 20, 'Fundamentals', '', false, 'Scheduled', v_other_gym_id
  ) returning id into v_cross_gym_class_id;

  insert into public.attendance (
    student_id, class_id, check_in_date, class_type, notes, gym_id
  ) values (
    v_cross_gym_student_id, v_cross_gym_class_id, v_scheduled_fixture_at,
    'Fundamentals', '', v_other_gym_id
  );

  insert into public.attendance (
    student_id, class_id, check_in_date, class_type, notes, gym_id
  ) values (
    v_student_id, v_scheduled_class_id, v_scheduled_fixture_at,
    'Fundamentals', '', v_gym_id
  );

  -- A nullable class ID is a valid Open Mat check-in. Its displayed date must
  -- come from the linked gym time zone, not the session time zone.
  insert into public.attendance (
    student_id, class_id, check_in_date, class_type, notes, gym_id
  ) values (
    v_student_id, null, v_timezone_fixture_at, v_timezone_fixture_name, '', v_gym_id
  );

  begin
    insert into public.attendance (
      student_id, class_id, check_in_date, class_type, notes, gym_id
    ) values (
      v_student_id, v_cross_gym_class_id, v_timezone_fixture_at,
      v_mismatch_fixture_name, '', v_gym_id
    );
    v_mismatch_row_inserted := true;
  exception when foreign_key_violation then
    v_mismatch_row_inserted := false;
  end;

  -- A class ID from a different gym must not satisfy the function's class join.
  if exists (
    select 1
    from (values (v_cross_gym_class_id, v_gym_id)) as attempted(class_id, gym_id)
    join public.classes scheduled_class
      on scheduled_class.id = attempted.class_id
     and scheduled_class.gym_id = attempted.gym_id
  ) then
    raise exception 'FAIL setup: cross-gym class fixture did not belong to the second gym.';
  end if;

  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  execute 'set local role authenticated';
  select * into v_link
  from public.approve_member_account_link(
    v_gym_id, v_student_id, v_family, 'parent_guardian', gen_random_uuid()
  );
  perform public.approve_member_account_link(
    v_gym_id, v_empty_student_id, v_family, 'parent_guardian', gen_random_uuid()
  );

  execute 'reset role';
  perform set_config('request.jwt.claim.sub', v_family::text, true);
  execute 'set local role authenticated';
  select count(*) into v_count from public.my_linked_member_attendance(v_student_id);
  if v_count = 0 then
    raise exception 'FAIL: approved family account did not receive its linked member attendance.';
  end if;
  if not exists (
    select 1
    from public.my_linked_member_attendance(v_student_id) result
    where result.class_name is not distinct from v_fallback_name
      and result.class_date is not distinct from v_fallback_date
      and result.attendance_status = 'checked_in'
  ) then
    raise exception 'FAIL: nullable class_id did not return the attendance class label and check-in date fallback.';
  end if;
  if not exists (
    select 1
    from public.my_linked_member_attendance(v_student_id) result
    where result.class_name is not distinct from v_scheduled_name
      and result.class_date is not distinct from v_scheduled_date
      and result.attendance_status = 'checked_in'
  ) then
    raise exception 'FAIL: scheduled attendance did not preserve the UTC class calendar date.';
  end if;

  execute 'set local time zone ''UTC''';
  select result.class_date into v_utc_session_date
  from public.my_linked_member_attendance(v_student_id) result
  where result.class_name = v_timezone_fixture_name;

  execute 'set local time zone ''Pacific/Kiritimati''';
  select result.class_date into v_kiritimati_session_date
  from public.my_linked_member_attendance(v_student_id) result
  where result.class_name = v_timezone_fixture_name;

  if v_utc_session_date is distinct from v_timezone_expected_date
    or v_kiritimati_session_date is distinct from v_timezone_expected_date
    or v_utc_session_date is distinct from v_kiritimati_session_date then
    raise exception 'FAIL: check-in date did not use the linked gym time zone independently of the session time zone.';
  end if;

  if v_mismatch_row_inserted and exists (
    select 1
    from public.my_linked_member_attendance(v_student_id) result
    where result.class_name = v_mismatch_fixture_name
  ) then
    raise exception 'FAIL: attendance with a mismatched class gym appeared in the family RPC.';
  end if;

  for v_result in select * from public.my_linked_member_attendance(v_student_id) loop
    if v_seen_null_date and v_result.class_date is not null then
      raise exception 'FAIL: a non-null class date appeared after a null class date.';
    end if;
    if v_previous_date is not null and v_result.class_date is not null
      and v_result.class_date > v_previous_date then
      raise exception 'FAIL: attendance was not returned newest class date first.';
    end if;
    if v_result.class_date is null then
      v_seen_null_date := true;
    else
      v_previous_date := v_result.class_date;
    end if;
  end loop;
  select count(*) into v_count from public.my_linked_member_attendance(v_empty_student_id);
  if v_count <> 0 then
    raise exception 'FAIL: missing attendance was represented as an attendance or absence row.';
  end if;
  select count(*) into v_count
  from public.attendance attendance
  where attendance.gym_id = v_gym_id and attendance.student_id = v_student_id;
  if v_count <> 0 then
    raise exception 'FAIL: family account has direct attendance-table access.';
  end if;

  begin
    perform 1 from public.my_linked_member_attendance(v_other_student_id);
    raise exception 'FAIL: family read an unlinked member attendance.';
  exception when insufficient_privilege then null;
  end;

  begin
    perform 1 from public.my_linked_member_attendance(v_cross_gym_student_id);
    raise exception 'FAIL: family read cross-gym attendance.';
  exception when insufficient_privilege then null;
  end;

  execute 'reset role';
  perform set_config('request.jwt.claim.sub', v_other_family::text, true);
  execute 'set local role authenticated';
  begin
    perform 1 from public.my_linked_member_attendance(v_student_id);
    raise exception 'FAIL: other-family account read attendance.';
  exception when insufficient_privilege then null;
  end;

  execute 'reset role';
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  execute 'set local role authenticated';
  perform public.revoke_member_account_link(v_link.id, gen_random_uuid());

  execute 'reset role';
  perform set_config('request.jwt.claim.sub', v_family::text, true);
  execute 'set local role authenticated';
  begin
    perform 1 from public.my_linked_member_attendance(v_student_id);
    raise exception 'FAIL: revoked family access still returned attendance.';
  exception when insufficient_privilege then null;
  end;

  execute 'reset role';
end;
$test$;

rollback;
