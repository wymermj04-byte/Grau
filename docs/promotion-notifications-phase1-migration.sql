-- REVIEWED MIGRATION — DEPLOY ONLY WITH EXPLICIT APPROVAL.
-- Grau Zero Promotion Notifications: Phase 1 disabled foundation.
--
-- This is additive and transactional. It creates only private notification
-- objects. It does not alter public tables, functions, triggers, policies,
-- attendance rules, promotion thresholds, Family Self-Check-In, or app code.
-- It creates no rollout row, notification event, inbox row, outbox row, or
-- historical backfill. PostgreSQL compilation and rollback testing have not
-- been performed from this repository.

begin;

-- Fail closed if Main does not match the reviewed contract or a prior private
-- notification deployment already exists.
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'grau_promotion_notifications_private') then
    raise exception 'grau_promotion_notifications_private already exists; stop and inventory it before deployment.';
  end if;

  if not exists (
    select 1 from pg_roles
    where rolname = 'postgres' and (rolsuper or rolbypassrls)
  ) then
    raise exception 'Phase 1 requires the postgres owner role to bypass row-level security for reviewed SECURITY DEFINER private helpers.';
  end if;

  if to_regclass('public.gym_settings') is null
     or to_regclass('public.students') is null
     or to_regclass('public.attendance') is null
     or to_regclass('public."Promotions"') is null
     or to_regclass('public.member_account_links') is null
     or to_regclass('public.gym_staff') is null
     or to_regclass('public.student_historical_promotion_boundaries') is null
     or to_regclass('public.student_stripe_progress_baselines') is null then
    raise exception 'Required reviewed notification source tables are missing.';
  end if;

  if not exists (
    select 1 from pg_constraint con
    where con.conrelid = 'public.gym_settings'::regclass
      and con.contype in ('p', 'u')
      and (
        select array_agg(att.attname::text order by key_part.ordinality)
        from unnest(con.conkey::smallint[]) with ordinality as key_part(attnum, ordinality)
        join pg_attribute att on att.attrelid = con.conrelid and att.attnum = key_part.attnum and not att.attisdropped
      ) = array['id']::text[]
  ) then
    raise exception 'gym_settings.id must be a primary or unique key for Phase 1 foreign keys.';
  end if;

  if not exists (
    select 1 from pg_constraint con
    where con.conrelid = 'public.students'::regclass
      and con.contype in ('p', 'u')
      and (
        select array_agg(att.attname::text order by key_part.ordinality)
        from unnest(con.conkey::smallint[]) with ordinality as key_part(attnum, ordinality)
        join pg_attribute att on att.attrelid = con.conrelid and att.attnum = key_part.attnum and not att.attisdropped
      ) = array['studentId', 'gym_id']::text[]
  ) then
    raise exception 'students must retain a unique (studentId, gym_id) key for Phase 1 foreign keys.';
  end if;

  if not exists (
    select 1 from pg_constraint con
    where con.conrelid = 'public.attendance'::regclass
      and con.contype in ('p', 'u')
      and (
        select array_agg(att.attname::text order by key_part.ordinality)
        from unnest(con.conkey::smallint[]) with ordinality as key_part(attnum, ordinality)
        join pg_attribute att on att.attrelid = con.conrelid and att.attnum = key_part.attnum and not att.attisdropped
      ) = array['id']::text[]
  ) then
    raise exception 'attendance.id must be a primary or unique key for Phase 1 foreign keys.';
  end if;

  if not exists (
    select 1 from pg_constraint con
    where con.conrelid = 'public.member_account_links'::regclass
      and con.contype in ('p', 'u')
      and (
        select array_agg(att.attname::text order by key_part.ordinality)
        from unnest(con.conkey::smallint[]) with ordinality as key_part(attnum, ordinality)
        join pg_attribute att on att.attrelid = con.conrelid and att.attnum = key_part.attnum and not att.attisdropped
      ) = array['id']::text[]
  ) then
    raise exception 'member_account_links.id must be a primary or unique key for Phase 1 foreign keys.';
  end if;

  if not exists (select 1 from pg_constraint where conrelid = 'public."Promotions"'::regclass and contype = 'p') then
    raise exception 'Promotions must retain its reviewed primary key.';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'students'
      and column_name in ('studentId', 'gym_id', 'belt_rank', 'stripes', 'promotion_track')
    group by table_schema, table_name having count(*) = 5
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'attendance'
      and column_name in ('id', 'gym_id', 'student_id', 'class_id', 'stripe_progress_classification')
    group by table_schema, table_name having count(*) = 5
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'Promotions'
      and column_name in ('id', 'gym_id', 'student_id', 'new_belt', 'new_stripes', 'promotion_effective_at', 'promotion_track_at_promotion')
    group by table_schema, table_name having count(*) = 7
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'member_account_links'
      and column_name in ('id', 'gym_id', 'student_id', 'user_id', 'status', 'revoked_at')
    group by table_schema, table_name having count(*) = 6
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'gym_staff'
      and column_name in ('gym_id', 'user_id', 'role', 'is_active')
    group by table_schema, table_name having count(*) = 4
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'student_historical_promotion_boundaries'
      and column_name in ('id', 'gym_id', 'student_id', 'last_promotion_date', 'belt_rank_at_confirmation', 'stripes_at_confirmation', 'promotion_track_at_confirmation')
    group by table_schema, table_name having count(*) = 7
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'student_stripe_progress_baselines'
      and column_name in ('id', 'gym_id', 'student_id', 'cutoff_exclusive_at', 'starting_class_count', 'belt_rank_at_confirmation', 'stripes_at_confirmation', 'promotion_track_at_confirmation')
    group by table_schema, table_name having count(*) = 8
  ) then
    raise exception 'One or more reviewed source-table column contracts do not match Main.';
  end if;
end
$$;

create schema grau_promotion_notifications_private authorization postgres;
revoke all on schema grau_promotion_notifications_private from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema grau_promotion_notifications_private revoke all on tables from public;
alter default privileges for role postgres in schema grau_promotion_notifications_private revoke all on sequences from public;
alter default privileges for role postgres in schema grau_promotion_notifications_private revoke execute on functions from public;

create table grau_promotion_notifications_private.gym_notification_rollouts (
  gym_id bigint primary key references public.gym_settings(id) on delete restrict,
  enabled boolean not null default false,
  activated_at timestamptz,
  activated_by uuid,
  generation_floor_at timestamptz,
  disabled_at timestamptz,
  disabled_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint gym_notification_rollouts_enabled_audit_check check (
    not enabled or (activated_at is not null and activated_by is not null and generation_floor_at is not null)
  )
);

-- Future rollout-control functions must enforce safe activation and
-- deactivation transitions, preserve generation_floor_at once set, and never
-- permit historical notification generation. No rollout-control function is
-- created by Phase 1.

create table grau_promotion_notifications_private.advancement_cycles (
  id bigint generated always as identity primary key,
  gym_id bigint not null references public.gym_settings(id) on delete restrict,
  student_id bigint not null,
  promotion_track text not null check (promotion_track in ('kids', 'adults')),
  belt_rank text not null check (length(btrim(belt_rank)) > 0),
  stripe_count integer not null check (stripe_count >= 0),
  boundary_kind text not null check (boundary_kind in ('official_promotion', 'historical_boundary', 'baseline')),
  boundary_record_id bigint not null,
  required_qualifying_classes integer not null check (required_qualifying_classes > 0),
  created_at timestamptz not null default now(),
  constraint advancement_cycles_student_gym_fkey foreign key (student_id, gym_id)
    references public.students("studentId", gym_id) on delete restrict,
  constraint advancement_cycles_identity_key unique (gym_id, student_id, promotion_track, belt_rank, stripe_count, boundary_kind, boundary_record_id),
  constraint advancement_cycles_id_gym_student_key unique (id, gym_id, student_id)
);

create index advancement_cycles_lookup_idx on grau_promotion_notifications_private.advancement_cycles
  (gym_id, student_id, promotion_track, belt_rank, stripe_count, created_at desc);

create table grau_promotion_notifications_private.staff_milestone_events (
  id bigint generated always as identity primary key,
  gym_id bigint not null,
  student_id bigint not null,
  advancement_cycle_id bigint not null,
  milestone_kind text not null check (milestone_kind in ('five_remaining', 'eligible_for_review')),
  first_observed_attendance_id bigint not null references public.attendance(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint staff_milestone_events_cycle_fkey foreign key (advancement_cycle_id, gym_id, student_id)
    references grau_promotion_notifications_private.advancement_cycles (id, gym_id, student_id) on delete restrict,
  constraint staff_milestone_events_cycle_kind_key unique (advancement_cycle_id, milestone_kind),
  constraint staff_milestone_events_id_gym_student_key unique (id, gym_id, student_id)
);

create index staff_milestone_events_reconciliation_idx on grau_promotion_notifications_private.staff_milestone_events
  (gym_id, student_id, created_at desc);

create table grau_promotion_notifications_private.promotion_notification_outbox (
  id bigint generated always as identity primary key,
  gym_id bigint not null references public.gym_settings(id) on delete restrict,
  student_id bigint not null,
  promotion_id bigint not null references public."Promotions"(id) on delete restrict,
  notification_kind text not null check (notification_kind = 'promotion_celebration'),
  state text not null default 'pending' check (state in ('pending', 'processing', 'retry_scheduled', 'delivered', 'dead_letter')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default now(),
  lease_token uuid,
  lease_expires_at timestamptz,
  last_error_code text,
  last_error_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint promotion_notification_outbox_processing_lease_check check (
    state <> 'processing' or (lease_token is not null and lease_expires_at is not null and lease_expires_at > created_at)
  ),
  constraint promotion_notification_outbox_non_processing_lease_check check (
    state = 'processing' or (lease_token is null and lease_expires_at is null)
  ),
  constraint promotion_notification_outbox_delivered_check check (state <> 'delivered' or delivered_at is not null),
  constraint promotion_notification_outbox_non_delivered_check check (state = 'delivered' or delivered_at is null),
  constraint promotion_notification_outbox_promotion_kind_key unique (promotion_id, notification_kind),
  constraint promotion_notification_outbox_id_gym_student_key unique (id, gym_id, student_id)
);

create index promotion_notification_outbox_due_idx on grau_promotion_notifications_private.promotion_notification_outbox
  (state, next_attempt_at, created_at)
  where state in ('pending', 'retry_scheduled', 'processing');

create table grau_promotion_notifications_private.promotion_outbox_recipients (
  outbox_id bigint not null,
  gym_id bigint not null,
  student_id bigint not null,
  family_user_id uuid not null,
  member_account_link_id bigint not null references public.member_account_links(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint promotion_outbox_recipients_outbox_fkey foreign key (outbox_id, gym_id, student_id)
    references grau_promotion_notifications_private.promotion_notification_outbox (id, gym_id, student_id) on delete restrict,
  constraint promotion_outbox_recipients_outbox_user_key unique (outbox_id, family_user_id)
);

create index promotion_outbox_recipients_family_lookup_idx on grau_promotion_notifications_private.promotion_outbox_recipients
  (family_user_id, gym_id, student_id);

create table grau_promotion_notifications_private.notification_events (
  id bigint generated always as identity primary key,
  gym_id bigint not null references public.gym_settings(id) on delete restrict,
  student_id bigint not null,
  event_kind text not null check (event_kind in ('promotion_celebration', 'five_remaining', 'eligible_for_review')),
  promotion_outbox_id bigint,
  staff_milestone_event_id bigint,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint notification_events_source_check check (
    (event_kind = 'promotion_celebration' and promotion_outbox_id is not null and staff_milestone_event_id is null)
    or (event_kind in ('five_remaining', 'eligible_for_review') and promotion_outbox_id is null and staff_milestone_event_id is not null)
  ),
  constraint notification_events_celebration_once_key unique (promotion_outbox_id),
  constraint notification_events_staff_milestone_once_key unique (staff_milestone_event_id),
  constraint notification_events_id_gym_student_key unique (id, gym_id, student_id)
);

create index notification_events_gym_created_idx on grau_promotion_notifications_private.notification_events
  (gym_id, created_at desc);

create table grau_promotion_notifications_private.notification_inbox (
  id bigint generated always as identity primary key,
  event_id bigint not null,
  gym_id bigint not null,
  student_id bigint not null,
  recipient_user_id uuid not null,
  recipient_role text not null check (recipient_role in ('family', 'staff')),
  read_at timestamptz,
  created_at timestamptz not null default now(),
  constraint notification_inbox_event_fkey foreign key (event_id, gym_id, student_id)
    references grau_promotion_notifications_private.notification_events (id, gym_id, student_id) on delete restrict,
  constraint notification_inbox_recipient_key unique (event_id, recipient_user_id, recipient_role)
);

create index notification_inbox_recipient_unread_idx on grau_promotion_notifications_private.notification_inbox
  (recipient_user_id, gym_id, created_at desc) where read_at is null;

-- Generic insert-time validation uses JSON so it is safe across the distinct
-- row types on which it is installed.
create function grau_promotion_notifications_private.validate_notification_insert()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public, grau_promotion_notifications_private, pg_temp
as $$
declare
  v_row jsonb := to_jsonb(new);
  v_expected integer;
  v_belt text;
  v_track text;
  v_stripes integer;
  v_gym_id bigint;
  v_student_id bigint;
begin
  v_gym_id := (v_row->>'gym_id')::bigint;
  v_student_id := (v_row->>'student_id')::bigint;

  if tg_table_name = 'advancement_cycles' then
    v_track := v_row->>'promotion_track';
    v_belt := lower(btrim(v_row->>'belt_rank'));
    v_stripes := (v_row->>'stripe_count')::integer;

    -- Must remain in parity with lib/stripe-progress.ts. Any future change
    -- there requires a notification-threshold compatibility review.
    v_expected := case
      when v_track = 'kids' then 30
      when v_track = 'adults' and v_stripes >= 4 and v_belt = 'white' then 40
      when v_track = 'adults' and v_stripes >= 4 and v_belt = 'blue' then 60
      when v_track = 'adults' and v_stripes >= 4 and v_belt = 'purple' then 90
      when v_track = 'adults' and v_stripes >= 4 and v_belt = 'brown' then 110
      when v_track = 'adults' and v_stripes in (0, 1) and v_belt = 'white' then 30
      when v_track = 'adults' and v_stripes in (2, 3) and v_belt = 'white' then 40
      when v_track = 'adults' and v_stripes in (0, 1) and v_belt = 'blue' then 50
      when v_track = 'adults' and v_stripes in (2, 3) and v_belt = 'blue' then 60
      when v_track = 'adults' and v_stripes in (0, 1) and v_belt = 'purple' then 80
      when v_track = 'adults' and v_stripes in (2, 3) and v_belt = 'purple' then 90
      when v_track = 'adults' and v_stripes in (0, 1) and v_belt = 'brown' then 100
      when v_track = 'adults' and v_stripes in (2, 3) and v_belt = 'brown' then 110
      else null
    end;

    if v_expected is null or (v_row->>'required_qualifying_classes')::integer <> v_expected then
      raise exception 'Advancement-cycle threshold does not match the existing Kids or Adults promotion rule.' using errcode = '23514';
    end if;

    if v_row->>'boundary_kind' = 'official_promotion' and not exists (
      select 1 from public."Promotions" promotion
      where promotion.id = (v_row->>'boundary_record_id')::bigint
        and promotion.gym_id = v_gym_id and promotion.student_id = v_student_id
        and lower(btrim(promotion.new_belt)) = v_belt and promotion.new_stripes = v_stripes
        and lower(btrim(promotion.promotion_track_at_promotion)) = v_track
    ) then raise exception 'Official promotion boundary does not match cycle.' using errcode = '23514'; end if;

    if v_row->>'boundary_kind' = 'historical_boundary' and not exists (
      select 1 from public.student_historical_promotion_boundaries boundary
      where boundary.id = (v_row->>'boundary_record_id')::bigint
        and boundary.gym_id = v_gym_id and boundary.student_id = v_student_id
        and lower(btrim(boundary.belt_rank_at_confirmation)) = v_belt
        and boundary.stripes_at_confirmation = v_stripes
        and lower(btrim(boundary.promotion_track_at_confirmation)) = v_track
    ) then raise exception 'Historical promotion boundary does not match cycle.' using errcode = '23514'; end if;

    if v_row->>'boundary_kind' = 'baseline' and not exists (
      select 1 from public.student_stripe_progress_baselines baseline
      where baseline.id = (v_row->>'boundary_record_id')::bigint
        and baseline.gym_id = v_gym_id and baseline.student_id = v_student_id
        and lower(btrim(baseline.belt_rank_at_confirmation)) = v_belt
        and baseline.stripes_at_confirmation = v_stripes
        and lower(btrim(baseline.promotion_track_at_confirmation)) = v_track
    ) then raise exception 'Stripe-progress baseline does not match cycle.' using errcode = '23514'; end if;

  elsif tg_table_name = 'staff_milestone_events' then
    if not exists (
      select 1 from public.attendance attendance
      where attendance.id = (v_row->>'first_observed_attendance_id')::bigint
        and attendance.gym_id = v_gym_id and attendance.student_id = v_student_id
    ) then raise exception 'Staff milestone attendance does not match gym and student.' using errcode = '23514'; end if;

  elsif tg_table_name = 'promotion_notification_outbox' then
    if not exists (
      select 1 from public."Promotions" promotion
      where promotion.id = (v_row->>'promotion_id')::bigint
        and promotion.gym_id = v_gym_id and promotion.student_id = v_student_id
    ) then raise exception 'Promotion outbox does not match official promotion.' using errcode = '23514'; end if;

  elsif tg_table_name = 'promotion_outbox_recipients' then
    if not exists (
      select 1 from public.member_account_links member_link
      where member_link.id = (v_row->>'member_account_link_id')::bigint
        and member_link.gym_id = v_gym_id and member_link.student_id = v_student_id
        and member_link.user_id = (v_row->>'family_user_id')::uuid
        and member_link.status = 'approved' and member_link.revoked_at is null
    ) then raise exception 'Recipient snapshot requires an approved, unrevoked matching family link.' using errcode = '23514'; end if;

  elsif tg_table_name = 'notification_events' then
    if v_row->>'event_kind' = 'promotion_celebration' and not exists (
      select 1 from grau_promotion_notifications_private.promotion_notification_outbox outbox
      where outbox.id = (v_row->>'promotion_outbox_id')::bigint
        and outbox.gym_id = v_gym_id and outbox.student_id = v_student_id
    ) then raise exception 'Celebration event must reference matching official-promotion outbox.' using errcode = '23514'; end if;

    if v_row->>'event_kind' in ('five_remaining', 'eligible_for_review') and not exists (
      select 1 from grau_promotion_notifications_private.staff_milestone_events milestone
      where milestone.id = (v_row->>'staff_milestone_event_id')::bigint
        and milestone.gym_id = v_gym_id and milestone.student_id = v_student_id
        and milestone.milestone_kind = v_row->>'event_kind'
    ) then raise exception 'Staff event must reference matching staff milestone.' using errcode = '23514'; end if;

  elsif tg_table_name = 'notification_inbox' then
    if v_row->>'recipient_role' = 'family' and not exists (
      select 1
      from grau_promotion_notifications_private.notification_events event
      join grau_promotion_notifications_private.promotion_outbox_recipients recipient
        on recipient.outbox_id = event.promotion_outbox_id
       and recipient.gym_id = event.gym_id and recipient.student_id = event.student_id
      where event.id = (v_row->>'event_id')::bigint
        and event.gym_id = v_gym_id and event.student_id = v_student_id
        and event.event_kind = 'promotion_celebration'
        and recipient.family_user_id = (v_row->>'recipient_user_id')::uuid
    ) then raise exception 'Family inbox entries require matching celebration recipient snapshots.' using errcode = '23514'; end if;

    if v_row->>'recipient_role' = 'staff' and not exists (
      select 1
      from grau_promotion_notifications_private.notification_events event
      join grau_promotion_notifications_private.staff_milestone_events milestone
        on milestone.id = event.staff_milestone_event_id
       and milestone.gym_id = event.gym_id and milestone.student_id = event.student_id
      join public.gym_staff staff
        on staff.gym_id = event.gym_id and staff.user_id = (v_row->>'recipient_user_id')::uuid
       and staff.is_active = true and staff.role in ('admin', 'coach')
      where event.id = (v_row->>'event_id')::bigint
        and event.gym_id = v_gym_id and event.student_id = v_student_id
        and event.event_kind in ('five_remaining', 'eligible_for_review')
    ) then raise exception 'Staff inbox entries require matching active-staff milestone events.' using errcode = '23514'; end if;
  end if;

  return new;
end;
$$;

alter function grau_promotion_notifications_private.validate_notification_insert() owner to postgres;

create trigger advancement_cycles_validate_insert before insert on grau_promotion_notifications_private.advancement_cycles for each row execute function grau_promotion_notifications_private.validate_notification_insert();
create trigger staff_milestone_events_validate_insert before insert on grau_promotion_notifications_private.staff_milestone_events for each row execute function grau_promotion_notifications_private.validate_notification_insert();
create trigger promotion_notification_outbox_validate_insert before insert on grau_promotion_notifications_private.promotion_notification_outbox for each row execute function grau_promotion_notifications_private.validate_notification_insert();
create trigger promotion_outbox_recipients_validate_insert before insert on grau_promotion_notifications_private.promotion_outbox_recipients for each row execute function grau_promotion_notifications_private.validate_notification_insert();
create trigger notification_events_validate_insert before insert on grau_promotion_notifications_private.notification_events for each row execute function grau_promotion_notifications_private.validate_notification_insert();
create trigger notification_inbox_validate_insert before insert on grau_promotion_notifications_private.notification_inbox for each row execute function grau_promotion_notifications_private.validate_notification_insert();

create function grau_promotion_notifications_private.reject_immutable_mutation()
returns trigger language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  raise exception 'This notification record is immutable.' using errcode = '42501';
end;
$$;

alter function grau_promotion_notifications_private.reject_immutable_mutation() owner to postgres;

create trigger advancement_cycles_immutable before update or delete on grau_promotion_notifications_private.advancement_cycles for each row execute function grau_promotion_notifications_private.reject_immutable_mutation();
create trigger staff_milestone_events_immutable before update or delete on grau_promotion_notifications_private.staff_milestone_events for each row execute function grau_promotion_notifications_private.reject_immutable_mutation();
create trigger promotion_outbox_recipients_immutable before update or delete on grau_promotion_notifications_private.promotion_outbox_recipients for each row execute function grau_promotion_notifications_private.reject_immutable_mutation();
create trigger notification_events_immutable before update or delete on grau_promotion_notifications_private.notification_events for each row execute function grau_promotion_notifications_private.reject_immutable_mutation();

create function grau_promotion_notifications_private.guard_outbox_mutation()
returns trigger language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Promotion notification outbox rows are never deleted.' using errcode = '42501';
  end if;
  if old.id is distinct from new.id
     or old.gym_id is distinct from new.gym_id
     or old.student_id is distinct from new.student_id
     or old.promotion_id is distinct from new.promotion_id
     or old.notification_kind is distinct from new.notification_kind
     or old.created_at is distinct from new.created_at then
    raise exception 'Promotion notification outbox identity is immutable.' using errcode = '42501';
  end if;
  return new;
end;
$$;

alter function grau_promotion_notifications_private.guard_outbox_mutation() owner to postgres;

create trigger promotion_notification_outbox_guard_mutation
before update or delete on grau_promotion_notifications_private.promotion_notification_outbox
for each row execute function grau_promotion_notifications_private.guard_outbox_mutation();

create function grau_promotion_notifications_private.guard_notification_inbox_mutation()
returns trigger language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Notification inbox entries are never deleted.' using errcode = '42501';
  end if;
  if old.event_id is distinct from new.event_id
     or old.id is distinct from new.id
     or old.gym_id is distinct from new.gym_id
     or old.student_id is distinct from new.student_id
     or old.recipient_user_id is distinct from new.recipient_user_id
     or old.recipient_role is distinct from new.recipient_role
     or old.created_at is distinct from new.created_at
     or old.read_at is not null
     or new.read_at is null then
    raise exception 'Only one unread-to-read transition is permitted.' using errcode = '42501';
  end if;
  return new;
end;
$$;

alter function grau_promotion_notifications_private.guard_notification_inbox_mutation() owner to postgres;

create trigger notification_inbox_guard_mutation
before update or delete on grau_promotion_notifications_private.notification_inbox
for each row execute function grau_promotion_notifications_private.guard_notification_inbox_mutation();

-- Future mark-read RPCs must authorize the caller, update only unread rows,
-- then report an authorized already-read row as success without changing its timestamp.

alter table grau_promotion_notifications_private.gym_notification_rollouts enable row level security;
alter table grau_promotion_notifications_private.gym_notification_rollouts force row level security;
alter table grau_promotion_notifications_private.advancement_cycles enable row level security;
alter table grau_promotion_notifications_private.advancement_cycles force row level security;
alter table grau_promotion_notifications_private.staff_milestone_events enable row level security;
alter table grau_promotion_notifications_private.staff_milestone_events force row level security;
alter table grau_promotion_notifications_private.promotion_notification_outbox enable row level security;
alter table grau_promotion_notifications_private.promotion_notification_outbox force row level security;
alter table grau_promotion_notifications_private.promotion_outbox_recipients enable row level security;
alter table grau_promotion_notifications_private.promotion_outbox_recipients force row level security;
alter table grau_promotion_notifications_private.notification_events enable row level security;
alter table grau_promotion_notifications_private.notification_events force row level security;
alter table grau_promotion_notifications_private.notification_inbox enable row level security;
alter table grau_promotion_notifications_private.notification_inbox force row level security;

revoke all on all tables in schema grau_promotion_notifications_private from public, anon, authenticated, service_role;
revoke all on all sequences in schema grau_promotion_notifications_private from public, anon, authenticated, service_role;
revoke all on all functions in schema grau_promotion_notifications_private from public, anon, authenticated, service_role;

commit;
