-- REVIEW ONLY — DO NOT APPLY UNTIL THE LIVE INVENTORY AND STAGING TESTS ARE REVIEWED.
--
-- Phase one member access is deliberately additive. It does not change any
-- existing staff, student, payment, contact, attendance, or billing policy.
-- In particular, payment-tracking accounts and guardian/contact records are
-- not read by, or accepted as, authorization evidence.

begin;

do $$
begin
  if to_regclass('public.students') is null
    or to_regclass('public.gym_settings') is null
    or to_regclass('public.gym_staff') is null
    or to_regclass('auth.users') is null then
    raise exception 'Member access requires public.students, public.gym_settings, public.gym_staff, and auth.users.';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'students'
      and column_name = 'studentId' and data_type = 'bigint'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'students'
      and column_name in ('gym_id', 'first_name', 'last_name', 'belt_rank', 'stripes', 'membership_status', 'waiver_signed', 'photo_url', 'programs')
    group by table_schema, table_name
    having count(*) = 9
  ) then
    raise exception 'students must expose the existing member-profile columns and gym_id.';
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
    select 1 from pg_constraint
    where conrelid = 'public.students'::regclass
      and conname = 'students_student_id_gym_id_key'
      and contype = 'u'
      and pg_get_constraintdef(oid) = 'UNIQUE ("studentId", gym_id)'
  ) then
    raise exception 'The existing students_student_id_gym_id_key UNIQUE ("studentId", gym_id) constraint is required and will not be changed.';
  end if;

  if to_regclass('public.member_account_links') is not null
    or to_regclass('public.member_account_link_events') is not null
    or to_regprocedure('public.member_access_active_admin(bigint)') is not null
    or to_regprocedure('public.member_account_links_guard_lifecycle_mutation()') is not null
    or to_regprocedure('public.member_account_link_events_immutable()') is not null
    or to_regprocedure('public.approve_member_account_link(bigint,bigint,uuid,text,uuid)') is not null
    or to_regprocedure('public.revoke_member_account_link(bigint,uuid)') is not null
    or to_regprocedure('public.my_linked_members()') is not null
    or exists (
      select 1 from pg_trigger trigger
      join pg_class relation on relation.oid = trigger.tgrelid
      join pg_namespace schema on schema.oid = relation.relnamespace
      where not trigger.tgisinternal
        and schema.nspname = 'public'
        and trigger.tgname in ('member_account_links_lifecycle_guard', 'member_account_link_events_no_mutation')
    ) then
    raise exception 'Member-access objects already exist. Stop and review their deployed definitions; this migration never replaces them.';
  end if;
end
$$;

create table public.member_account_links (
  id bigint generated always as identity primary key,
  gym_id bigint not null references public.gym_settings(id) on delete restrict,
  student_id bigint not null,
  user_id uuid not null references auth.users(id) on delete restrict,
  relationship text not null check (relationship in ('self', 'parent_guardian')),
  status text not null check (status in ('approved', 'revoked')),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  approved_by uuid not null,
  approved_at timestamptz not null default now(),
  revoked_by uuid,
  revoked_at timestamptz,
  constraint member_account_links_student_gym_fkey
    foreign key (student_id, gym_id)
    references public.students("studentId", gym_id) on delete restrict,
  constraint member_account_links_link_key unique (gym_id, student_id, user_id),
  constraint member_account_links_id_gym_key unique (id, gym_id),
  constraint member_account_links_revocation_audit_check check (
    (status = 'approved')
    or (status = 'revoked' and revoked_by is not null and revoked_at is not null)
  )
);

create index member_account_links_user_status_idx
  on public.member_account_links (user_id, status, gym_id, student_id);

create table public.member_account_link_events (
  id bigint generated always as identity primary key,
  link_id bigint not null,
  gym_id bigint not null,
  student_id bigint not null,
  user_id uuid not null,
  relationship text not null check (relationship in ('self', 'parent_guardian')),
  event_type text not null check (event_type in ('approved', 'revoked')),
  actor_user_id uuid not null,
  request_key uuid not null,
  action_applied boolean not null,
  occurred_at timestamptz not null default now(),
  constraint member_account_link_events_link_gym_fkey
    foreign key (link_id, gym_id)
    references public.member_account_links(id, gym_id) on delete restrict,
  constraint member_account_link_events_student_gym_fkey
    foreign key (student_id, gym_id)
    references public.students("studentId", gym_id) on delete restrict,
  constraint member_account_link_events_actor_request_key unique (actor_user_id, request_key)
);

create index member_account_link_events_link_idx
  on public.member_account_link_events (link_id, occurred_at);

create function public.member_access_active_admin(p_gym_id bigint)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null and exists (
    select 1
    from public.gym_staff staff
    where staff.gym_id = p_gym_id
      and staff.user_id = auth.uid()
      and staff.is_active = true
      and staff.role = 'admin'
  );
$$;

create function public.member_account_links_guard_lifecycle_mutation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if current_setting('member_access.lifecycle_write', true) is distinct from 'on' then
    raise exception 'Member account links may only be changed through their audited RPCs.' using errcode = '42501';
  end if;

  if tg_op = 'DELETE' then
    raise exception 'Member account links are never deleted; revoke the link instead.' using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' and (
    new.id is distinct from old.id
    or new.gym_id is distinct from old.gym_id
    or new.student_id is distinct from old.student_id
    or new.user_id is distinct from old.user_id
    or new.relationship is distinct from old.relationship
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at
  ) then
    raise exception 'The linked account, member, gym, relationship, and creation audit are immutable.' using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger member_account_links_lifecycle_guard
before insert or update or delete on public.member_account_links
for each row execute function public.member_account_links_guard_lifecycle_mutation();

create function public.member_account_link_events_immutable()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  raise exception 'Member account-link events are append-only.' using errcode = '42501';
end;
$$;

create trigger member_account_link_events_no_mutation
before update or delete on public.member_account_link_events
for each row execute function public.member_account_link_events_immutable();

create function public.approve_member_account_link(
  p_gym_id bigint,
  p_student_id bigint,
  p_user_id uuid,
  p_relationship text,
  p_request_key uuid
)
returns public.member_account_links
language plpgsql
security definer
set search_path = pg_catalog, public, auth, pg_temp
as $$
declare
  v_link public.member_account_links%rowtype;
  v_request_event public.member_account_link_events%rowtype;
  v_link_exists boolean := false;
  v_request_exists boolean := false;
  v_prior_lifecycle_write text := current_setting('member_access.lifecycle_write', true);
  v_now timestamptz := now();
begin
  if p_gym_id is null or p_student_id is null or p_user_id is null or p_request_key is null
    or p_relationship is null or p_relationship not in ('self', 'parent_guardian') then
    raise exception 'A gym, member, existing account, valid relationship, and request key are required.';
  end if;
  if auth.uid() is null or not public.member_access_active_admin(p_gym_id) then
    raise exception 'Only an active administrator for this gym may approve member access.' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_request_key::text)::bigint);
  perform pg_advisory_xact_lock(p_student_id);
  select * into v_link
  from public.member_account_links
  where gym_id = p_gym_id and student_id = p_student_id and user_id = p_user_id
  for update;
  v_link_exists := found;

  select * into v_request_event
  from public.member_account_link_events
  where actor_user_id = auth.uid() and request_key = p_request_key
  for update;
  v_request_exists := found;
  if v_request_exists then
    if v_request_event.event_type <> 'approved'
      or v_request_event.gym_id <> p_gym_id
      or v_request_event.student_id <> p_student_id
      or v_request_event.user_id <> p_user_id
      or v_request_event.relationship <> p_relationship then
      raise exception 'This request key was already used with different approval inputs.' using errcode = '22023';
    end if;
    if not v_link_exists or v_link.id <> v_request_event.link_id then
      raise exception 'The link for this prior approval request no longer exists.';
    end if;
    return v_link;
  end if;

  if not exists (
    select 1 from public.students
    where "studentId" = p_student_id and gym_id = p_gym_id
  ) then
    raise exception 'The selected member does not belong to this gym.';
  end if;
  if not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'The target account must be an existing authenticated user.';
  end if;

  if v_link_exists and v_link.relationship <> p_relationship then
    raise exception 'The existing member-account link has a different relationship.' using errcode = '22023';
  end if;
  if v_link_exists and v_link.status = 'approved' then
    insert into public.member_account_link_events (
      link_id, gym_id, student_id, user_id, relationship,
      event_type, actor_user_id, request_key, action_applied, occurred_at
    ) values (
      v_link.id, v_link.gym_id, v_link.student_id, v_link.user_id, v_link.relationship,
      'approved', auth.uid(), p_request_key, false, v_now
    );
    return v_link;
  end if;

  begin
    perform set_config('member_access.lifecycle_write', 'on', true);
    if v_link_exists then
      update public.member_account_links
      set status = 'approved', approved_by = auth.uid(), approved_at = v_now,
          revoked_by = null, revoked_at = null
      where id = v_link.id
      returning * into v_link;
    else
      insert into public.member_account_links (
        gym_id, student_id, user_id, relationship, status,
        created_by, created_at, approved_by, approved_at
      ) values (
        p_gym_id, p_student_id, p_user_id, p_relationship, 'approved',
        auth.uid(), v_now, auth.uid(), v_now
      ) returning * into v_link;
    end if;

    insert into public.member_account_link_events (
      link_id, gym_id, student_id, user_id, relationship,
      event_type, actor_user_id, request_key, action_applied, occurred_at
    ) values (
      v_link.id, v_link.gym_id, v_link.student_id, v_link.user_id, v_link.relationship,
      'approved', auth.uid(), p_request_key, true, v_now
    );
    perform set_config('member_access.lifecycle_write', coalesce(v_prior_lifecycle_write, ''), true);
  exception when others then
    perform set_config('member_access.lifecycle_write', coalesce(v_prior_lifecycle_write, ''), true);
    raise;
  end;
  return v_link;
end;
$$;

create function public.revoke_member_account_link(p_link_id bigint, p_request_key uuid)
returns public.member_account_links
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_link public.member_account_links%rowtype;
  v_request_event public.member_account_link_events%rowtype;
  v_request_exists boolean := false;
  v_prior_lifecycle_write text := current_setting('member_access.lifecycle_write', true);
  v_now timestamptz := now();
begin
  if p_link_id is null or p_request_key is null then
    raise exception 'A member-account link and request key are required.';
  end if;

  select * into v_link
  from public.member_account_links
  where id = p_link_id;
  if not found then
    raise exception 'The member-account link was not found.';
  end if;
  if auth.uid() is null or not public.member_access_active_admin(v_link.gym_id) then
    raise exception 'Only an active administrator for this gym may revoke member access.' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_request_key::text)::bigint);
  perform pg_advisory_xact_lock(v_link.student_id);
  select * into v_link
  from public.member_account_links
  where id = p_link_id
  for update;
  if not found then
    raise exception 'The member-account link was not found.';
  end if;
  if not public.member_access_active_admin(v_link.gym_id) then
    raise exception 'Only an active administrator for this gym may revoke member access.' using errcode = '42501';
  end if;

  select * into v_request_event
  from public.member_account_link_events
  where actor_user_id = auth.uid() and request_key = p_request_key
  for update;
  v_request_exists := found;
  if v_request_exists then
    if v_request_event.event_type <> 'revoked' or v_request_event.link_id <> p_link_id then
      raise exception 'This request key was already used with different revocation inputs.' using errcode = '22023';
    end if;
    return v_link;
  end if;
  if v_link.status = 'revoked' then
    insert into public.member_account_link_events (
      link_id, gym_id, student_id, user_id, relationship,
      event_type, actor_user_id, request_key, action_applied, occurred_at
    ) values (
      v_link.id, v_link.gym_id, v_link.student_id, v_link.user_id, v_link.relationship,
      'revoked', auth.uid(), p_request_key, false, v_now
    );
    return v_link;
  end if;

  begin
    perform set_config('member_access.lifecycle_write', 'on', true);
    update public.member_account_links
    set status = 'revoked', revoked_by = auth.uid(), revoked_at = v_now
    where id = v_link.id
    returning * into v_link;

    insert into public.member_account_link_events (
      link_id, gym_id, student_id, user_id, relationship,
      event_type, actor_user_id, request_key, action_applied, occurred_at
    ) values (
      v_link.id, v_link.gym_id, v_link.student_id, v_link.user_id, v_link.relationship,
      'revoked', auth.uid(), p_request_key, true, v_now
    );
    perform set_config('member_access.lifecycle_write', coalesce(v_prior_lifecycle_write, ''), true);
  exception when others then
    perform set_config('member_access.lifecycle_write', coalesce(v_prior_lifecycle_write, ''), true);
    raise;
  end;
  return v_link;
end;
$$;

-- This is the only family-facing profile read. It intentionally does not
-- expose financial, attendance, billing, contact, staff, or other-family data.
create function public.my_linked_members()
returns table (
  student_id bigint,
  gym_id bigint,
  first_name text,
  last_name text,
  belt_rank text,
  stripes integer,
  membership_status text,
  waiver_signed boolean,
  photo_url text,
  programs text[]
)
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select
    student."studentId" as student_id,
    student.gym_id,
    student.first_name::text,
    student.last_name::text,
    student.belt_rank::text,
    student.stripes::integer,
    student.membership_status::text,
    student.waiver_signed,
    student.photo_url::text,
    student.programs::text[]
  from public.member_account_links link
  join public.students student
    on student."studentId" = link.student_id
   and student.gym_id = link.gym_id
  where link.user_id = auth.uid()
    and link.status = 'approved'
  order by student.last_name nulls last, student.first_name, student."studentId";
$$;

alter table public.member_account_links enable row level security;
alter table public.member_account_link_events enable row level security;

-- A family user can see only their own currently approved links. Same-gym
-- admins can inspect link state/history, but can only change it via the RPCs.
create policy member_account_links_read_own_approved
on public.member_account_links for select to authenticated
using (user_id = auth.uid() and status = 'approved');

create policy member_account_links_admin_read
on public.member_account_links for select to authenticated
using (public.member_access_active_admin(gym_id));

create policy member_account_link_events_admin_read
on public.member_account_link_events for select to authenticated
using (public.member_access_active_admin(gym_id));

revoke all on table public.member_account_links from public, anon, authenticated;
revoke all on table public.member_account_link_events from public, anon, authenticated;
revoke all on sequence public.member_account_links_id_seq from public, anon, authenticated;
revoke all on sequence public.member_account_link_events_id_seq from public, anon, authenticated;
revoke all on function public.member_access_active_admin(bigint) from public, anon;
revoke all on function public.member_account_links_guard_lifecycle_mutation() from public, anon, authenticated;
revoke all on function public.member_account_link_events_immutable() from public, anon, authenticated;
revoke all on function public.approve_member_account_link(bigint, bigint, uuid, text, uuid) from public, anon;
revoke all on function public.revoke_member_account_link(bigint, uuid) from public, anon;
revoke all on function public.my_linked_members() from public, anon;

grant execute on function public.member_access_active_admin(bigint) to authenticated;
grant select on table public.member_account_links to authenticated;
grant select on table public.member_account_link_events to authenticated;
grant execute on function public.approve_member_account_link(bigint, bigint, uuid, text, uuid) to authenticated;
grant execute on function public.revoke_member_account_link(bigint, uuid) to authenticated;
grant execute on function public.my_linked_members() to authenticated;

commit;
