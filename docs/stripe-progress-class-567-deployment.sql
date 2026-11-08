-- REVIEW ONLY — DO NOT DEPLOY.
--
-- Narrow Class 567 stripe-progress correction for Gym 4 only.
-- This transaction changes only public.get_gym_stripe_progress_context() and
-- creates a private rollback record. It does not update classes, attendance,
-- students, promotions, baselines, thresholds, messaging, or feature flags.

begin;

-- Fail closed unless the deployed function and Class 567 still match the
-- reviewed Main Supabase contract.
do $$
declare
  v_oid oid;
  v_md5 text;
  v_signature text;
  v_identity_arguments text;
  v_return_type text;
  v_language text;
  v_volatility "char";
  v_security_definer boolean;
  v_owner text;
  v_config text[];
  v_raw_acl text;
  v_overload_count integer;
  v_class_match_count integer;
  v_qualifying_attendance_count integer;
begin
  v_oid := to_regprocedure('public.get_gym_stripe_progress_context()');

  if v_oid is null then
    raise exception
      'Preflight failed: public.get_gym_stripe_progress_context() is missing.';
  end if;

  select count(*)
    into v_overload_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'get_gym_stripe_progress_context';

  if v_overload_count <> 1 then
    raise exception
      'Preflight failed: expected exactly one get_gym_stripe_progress_context overload, found %.',
      v_overload_count;
  end if;

  select
    md5(pg_get_functiondef(p.oid)),
    format('%I.%I(%s)', n.nspname, p.proname,
      pg_get_function_identity_arguments(p.oid)),
    pg_get_function_identity_arguments(p.oid),
    pg_get_function_result(p.oid),
    l.lanname,
    p.provolatile,
    p.prosecdef,
    pg_get_userbyid(p.proowner),
    p.proconfig,
    p.proacl::text
  into
    v_md5,
    v_signature,
    v_identity_arguments,
    v_return_type,
    v_language,
    v_volatility,
    v_security_definer,
    v_owner,
    v_config,
    v_raw_acl
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  join pg_language l on l.oid = p.prolang
  where p.oid = v_oid;

  if v_md5 <> 'b576f689f57a8f5a91610fb239702423'
     or v_signature <> 'public.get_gym_stripe_progress_context()'
     or v_identity_arguments <> ''
     or v_return_type <> 'jsonb'
     or v_language <> 'plpgsql'
     or v_volatility <> 's'
     or v_security_definer is not true
     or v_owner <> 'postgres'
     or v_config is distinct from
          array['search_path=pg_catalog, public, pg_temp']::text[]
     or v_raw_acl <> '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}'
  then
    raise exception
      'Preflight failed: get_gym_stripe_progress_context() differs from the reviewed deployment baseline.';
  end if;

  select count(*)
    into v_class_match_count
  from public.classes c
  where c.id = 567
    and c.gym_id = 4
    and c.class_date = timestamptz '2026-09-20 00:00:00+00'
    and c.start_time is null;

  if v_class_match_count <> 1 then
    raise exception
      'Preflight failed: Class 567 no longer matches the reviewed Gym 4, UTC-midnight, null-start-time condition.';
  end if;

  select count(*)
    into v_qualifying_attendance_count
  from public.attendance a
  where a.gym_id = 4
    and a.class_id = 567
    and a.stripe_progress_classification = 'qualifying';

  if v_qualifying_attendance_count <> 1 then
    raise exception
      'Preflight failed: expected exactly one qualifying attendance record for Class 567, found %.',
      v_qualifying_attendance_count;
  end if;

  if exists (
    select 1
    from pg_namespace
    where nspname = 'grau_stripe_progress_private'
  ) then
    raise exception
      'Preflight failed: private rollback schema already exists; do not overwrite an existing backup.';
  end if;
end;
$$;

-- Private schema is not part of the Supabase API schema list. Explicit
-- revocations prevent anon/authenticated access even if that changes later.
create schema grau_stripe_progress_private authorization postgres;

revoke all on schema grau_stripe_progress_private from public;
revoke all on schema grau_stripe_progress_private from anon;
revoke all on schema grau_stripe_progress_private from authenticated;

create table grau_stripe_progress_private.get_gym_stripe_progress_context_backup (
  function_signature text primary key,
  original_definition text not null,
  original_definition_md5 text not null,
  original_owner text not null,
  original_language text not null,
  original_volatility "char" not null,
  original_security_definer boolean not null,
  original_search_path text[] not null,
  original_identity_arguments text not null,
  original_return_type text not null,
  original_raw_acl text not null,
  post_deployment_definition_md5 text,
  captured_at timestamptz not null default now()
);

revoke all on table
  grau_stripe_progress_private.get_gym_stripe_progress_context_backup
  from public;
revoke all on table
  grau_stripe_progress_private.get_gym_stripe_progress_context_backup
  from anon;
revoke all on table
  grau_stripe_progress_private.get_gym_stripe_progress_context_backup
  from authenticated;

insert into grau_stripe_progress_private.get_gym_stripe_progress_context_backup (
  function_signature,
  original_definition,
  original_definition_md5,
  original_owner,
  original_language,
  original_volatility,
  original_security_definer,
  original_search_path,
  original_identity_arguments,
  original_return_type,
  original_raw_acl
)
select
  format('%I.%I(%s)', n.nspname, p.proname,
    pg_get_function_identity_arguments(p.oid)),
  pg_get_functiondef(p.oid),
  md5(pg_get_functiondef(p.oid)),
  pg_get_userbyid(p.proowner),
  l.lanname,
  p.provolatile,
  p.prosecdef,
  p.proconfig,
  pg_get_function_identity_arguments(p.oid),
  pg_get_function_result(p.oid),
  p.proacl::text
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
join pg_language l on l.oid = p.prolang
where p.oid = to_regprocedure('public.get_gym_stripe_progress_context()');

-- Exact reviewed definition, with only the verified Class 567 exception.
create or replace function public.get_gym_stripe_progress_context()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
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

  select settings.time_zone
  into v_timezone
  from public.gym_settings settings
  where settings.id = v_gym_id;

  if v_timezone is null or not exists (
    select 1
    from pg_timezone_names
    where name = v_timezone
  ) then
    raise exception 'This gym must have a valid configured time_zone before stripe progress can be calculated.';
  end if;

  return jsonb_build_object(
    'classes',
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', scheduled_class.id,
          'class_date', scheduled_class.class_date,
          'scheduled_class_day',
            (scheduled_class.class_date at time zone 'UTC')::date,
          'scheduled_start_at',
            case
              when scheduled_class.id = 567
               and scheduled_class.gym_id = 4
               and scheduled_class.class_date =
                     timestamptz '2026-09-20 00:00:00+00'
               and scheduled_class.start_time is null
              then null::timestamptz
              else (
                (
                  (
                    (scheduled_class.class_date at time zone 'UTC')::date
                    + scheduled_class.start_time
                  ) at time zone v_timezone
                )
              )
            end
        )
        order by scheduled_class.id
      )
      from public.classes scheduled_class
      where scheduled_class.gym_id = v_gym_id
        and scheduled_class.class_date is not null
        and scheduled_class.class_date = (
          date_trunc(
            'day',
            scheduled_class.class_date at time zone 'UTC'
          ) at time zone 'UTC'
        )
        and (
          scheduled_class.start_time is not null
          or (
            scheduled_class.id = 567
            and scheduled_class.gym_id = 4
            and scheduled_class.class_date =
                  timestamptz '2026-09-20 00:00:00+00'
            and scheduled_class.start_time is null
            and exists (
              select 1
              from public.attendance a
              where a.gym_id = 4
                and a.class_id = 567
                and a.stripe_progress_classification = 'qualifying'
            )
          )
        )
    ), '[]'::jsonb),

    'class_contract_exceptions',
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', scheduled_class.id,
          'class_date', scheduled_class.class_date
        )
        order by scheduled_class.id
      )
      from public.classes scheduled_class
      where scheduled_class.gym_id = v_gym_id
        and (
          scheduled_class.class_date is null
          or scheduled_class.start_time is null
          or scheduled_class.class_date <> (
            date_trunc(
              'day',
              scheduled_class.class_date at time zone 'UTC'
            ) at time zone 'UTC'
          )
        )
        and not (
          scheduled_class.id = 567
          and scheduled_class.gym_id = 4
          and scheduled_class.class_date =
                timestamptz '2026-09-20 00:00:00+00'
          and scheduled_class.start_time is null
          and exists (
            select 1
            from public.attendance a
            where a.gym_id = 4
              and a.class_id = 567
              and a.stripe_progress_classification = 'qualifying'
          )
        )
    ), '[]'::jsonb),

    'historical_boundaries',
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', boundary.id,
          'student_id', boundary.student_id,
          'last_promotion_date', boundary.last_promotion_date,
          'time_zone_at_confirmation',
            boundary.time_zone_at_confirmation,
          'confirmed_at', boundary.confirmed_at,
          'belt_rank_at_confirmation',
            boundary.belt_rank_at_confirmation,
          'stripes_at_confirmation',
            boundary.stripes_at_confirmation,
          'promotion_track_at_confirmation',
            boundary.promotion_track_at_confirmation
        )
        order by
          boundary.student_id,
          boundary.confirmed_at desc,
          boundary.id desc
      )
      from public.student_historical_promotion_boundaries boundary
      where boundary.gym_id = v_gym_id
    ), '[]'::jsonb)
  );
end;
$function$;

-- CREATE OR REPLACE preserves function ACLs; assert that every protected
-- catalog property and the existing raw ACL were retained before commit.
do $$
declare
  v_oid oid := to_regprocedure('public.get_gym_stripe_progress_context()');
  v_post_md5 text;
  v_signature text;
  v_identity_arguments text;
  v_return_type text;
  v_language text;
  v_volatility "char";
  v_security_definer boolean;
  v_owner text;
  v_config text[];
  v_raw_acl text;
begin
  select
    md5(pg_get_functiondef(p.oid)),
    format('%I.%I(%s)', n.nspname, p.proname,
      pg_get_function_identity_arguments(p.oid)),
    pg_get_function_identity_arguments(p.oid),
    pg_get_function_result(p.oid),
    l.lanname,
    p.provolatile,
    p.prosecdef,
    pg_get_userbyid(p.proowner),
    p.proconfig,
    p.proacl::text
  into
    v_post_md5,
    v_signature,
    v_identity_arguments,
    v_return_type,
    v_language,
    v_volatility,
    v_security_definer,
    v_owner,
    v_config,
    v_raw_acl
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  join pg_language l on l.oid = p.prolang
  where p.oid = v_oid;

  if v_post_md5 is null
     or v_signature <> 'public.get_gym_stripe_progress_context()'
     or v_identity_arguments <> ''
     or v_return_type <> 'jsonb'
     or v_language <> 'plpgsql'
     or v_volatility <> 's'
     or v_security_definer is not true
     or v_owner <> 'postgres'
     or v_config is distinct from
          array['search_path=pg_catalog, public, pg_temp']::text[]
     or v_raw_acl <> '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}'
  then
    raise exception
      'Post-deployment verification failed: protected function metadata or privileges changed.';
  end if;

  update grau_stripe_progress_private.get_gym_stripe_progress_context_backup
  set post_deployment_definition_md5 = v_post_md5
  where function_signature = 'public.get_gym_stripe_progress_context()';

  if not found then
    raise exception
      'Post-deployment verification failed: rollback backup was not retained.';
  end if;
end;
$$;

commit;
