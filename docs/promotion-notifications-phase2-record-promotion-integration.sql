-- REVIEW ONLY — DO NOT DEPLOY WITHOUT SEPARATE APPROVAL.
--
-- This patch is based on the live definition supplied for
-- public.record_student_promotion(bigint,text,integer,text). It preserves its
-- authorization, validation, row lock, public promotion insert, and student
-- update. The only behavioral addition is the private enqueue call after the
-- promotion row exists.
--
-- Live-contract confirmation: Main's fresh pg_get_functiondef result matches
-- this definition, including the valid normalized_type assignment below. The
-- doubled quotes in its CSV export are transport escaping, not SQL changes.

begin;

do $$
begin
  if to_regprocedure('grau_promotion_notifications_private.enqueue_verified_promotion_celebration(bigint,bigint,bigint,timestamp with time zone)') is null then
    raise exception 'Deploy the reviewed Phase 2 independent migration before integrating record_student_promotion.';
  end if;
  if to_regprocedure('public.record_student_promotion(bigint,text,integer,text)') is null then
    raise exception 'record_student_promotion is missing.';
  end if;
end
$$;

create or replace function public.record_student_promotion(
  p_student_id bigint,
  p_new_belt text,
  p_new_stripes integer,
  p_promotion_type text
)
returns void
language plpgsql
security definer
set search_path to 'public', 'auth', 'pg_temp'
as $function$
declare
  active_gym_id bigint;
  permitted_memberships integer;
  current_belt text;
  current_stripes smallint;
  normalized_belt text;
  normalized_type text;
  created_promotion_id bigint;
  created_promotion_effective_at timestamptz;
begin
  normalized_belt := trim(coalesce(p_new_belt, ''));
  normalized_type := lower(trim(coalesce(p_promotion_type, '')));

  if p_student_id is null
     or normalized_belt = ''
     or normalized_type = ''
     or p_new_stripes is null then
    raise exception 'Member, belt, stripe count, and promotion type are required.';
  end if;

  select count(*), min(gym_id)
    into permitted_memberships, active_gym_id
  from public.gym_staff
  where user_id = auth.uid()
    and is_active
    and role in ('admin', 'coach');

  if permitted_memberships <> 1 then
    raise exception 'An active admin or coach membership for exactly one gym is required.';
  end if;

  select belt_rank, stripes
    into current_belt, current_stripes
  from public.students
  where "studentId" = p_student_id
    and gym_id = active_gym_id
  for update;

  if not found then
    raise exception 'The selected member does not belong to your active gym.';
  end if;

  if trim(coalesce(current_belt, '')) = '' or current_stripes is null
     or p_new_stripes < 0 or p_new_stripes > 4 then
    raise exception 'Member rank or requested stripe count is invalid.';
  end if;

  if normalized_type = 'stripe' then
    if normalized_belt <> trim(current_belt)
       or current_stripes >= 4
       or p_new_stripes <> current_stripes + 1 then
      raise exception
        'A stripe promotion must retain the belt and add exactly one stripe, up to four.';
    end if;
  elsif normalized_type = 'belt' then
    if normalized_belt = trim(current_belt) then
      raise exception 'A belt promotion must select a new belt.';
    end if;
  else
    raise exception 'Promotion type must be stripe or belt.';
  end if;

  insert into public."Promotions" (
    student_id, gym_id, old_belt, new_belt,
    old_stripes, new_stripes, promotion_type
  ) values (
    p_student_id, active_gym_id, trim(current_belt), normalized_belt,
    current_stripes, p_new_stripes, normalized_type
  )
  returning id into created_promotion_id;

  -- Read the trigger-populated, database-assigned snapshot after INSERT.
  select promotion.promotion_effective_at
    into created_promotion_effective_at
  from public."Promotions" as promotion
  where promotion.id = created_promotion_id
    and promotion.gym_id = active_gym_id
    and promotion.student_id = p_student_id;

  perform grau_promotion_notifications_private.enqueue_verified_promotion_celebration(
    created_promotion_id,
    active_gym_id,
    p_student_id,
    created_promotion_effective_at
  );

  update public.students
  set belt_rank = normalized_belt,
      stripes = p_new_stripes::smallint
  where "studentId" = p_student_id
    and gym_id = active_gym_id;
end;
$function$;

commit;
