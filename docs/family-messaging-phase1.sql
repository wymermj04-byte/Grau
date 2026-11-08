-- REVIEW ONLY — DO NOT EXECUTE UNTIL APPROVED FOR MAIN SUPABASE.
--
-- Grau Zero Phase 1 family-to-academy messaging.  This migration is additive:
-- it creates only the objects named below and deliberately does not alter an
-- existing table, policy, trigger, function, sequence, privilege, or record.
-- Direct table writes are denied.  Authenticated callers use the explicitly
-- granted RPCs at the end of this file.
--
-- Public RPC contract
--   family_staff_get_or_create_conversation(p_gym_id bigint)
--     -> (conversation_id bigint, gym_id bigint, created_at timestamptz)
--   family_staff_upsert_staff_profile(p_user_id uuid, p_gym_id bigint,
--                                     p_display_name text)
--     -> the saved gym_staff_profiles row (active administrators only)
--   family_staff_send_family_message(p_gym_id bigint, p_body text,
--                                    p_idempotency_key uuid)
--     -> (conversation_id bigint, message_id bigint, created_at timestamptz)
--   family_staff_send_staff_message(p_conversation_id bigint, p_body text,
--                                   p_idempotency_key uuid)
--     -> (conversation_id bigint, message_id bigint, created_at timestamptz)
--   family_staff_list_family_conversations()
--     -> (conversation_id, gym_id, gym_name, latest_message_preview,
--         latest_sender_kind, latest_message_at, unread_count)
--   family_staff_list_staff_conversations(p_gym_id bigint)
--     -> (conversation_id, gym_id, family_label, latest_message_preview,
--         latest_sender_kind, latest_message_at, unread_count, can_reply)
--   family_staff_list_message_history(p_conversation_id bigint,
--                                     p_access_role text,
--                                     p_before_message_id bigint default null,
--                                     p_page_size integer default 50)
--     -> chronological rows (message_id, sender_kind, sender_label, body,
--                             created_at, has_more)
--   family_staff_open_unread_page(p_conversation_id bigint,
--                                 p_access_role text,
--                                 p_page_size integer default 50)
--     -> (read_cursor_id uuid, base_read_message_id bigint,
--         through_message_id bigint, has_more boolean, messages jsonb)
--   family_staff_acknowledge_read(p_conversation_id bigint,
--                                 p_access_role text,
--                                 p_read_cursor_id uuid,
--                                 p_through_message_id bigint)
--     -> (last_read_message_id bigint, acknowledged_at timestamptz)
--
-- All page sizes are 1..100.  A read cursor expires after 15 minutes and is
-- valid only for its issuing user, conversation, selected access role, base
-- read marker, and exact server-issued page endpoint. A dual-role user must
-- explicitly select `family` or `staff`; each role has an independent marker.
-- The client must acknowledge each unread page before requesting the next
-- page. Errors use 42501 (not authorized), 22023 (invalid input/cursor),
-- 40001 (stale concurrent acknowledgement), and P0002 (missing record),
-- without returning unauthorized data.

begin;

-- Fail before creating anything if Main no longer matches the reviewed
-- contracts, or if a prior/partial messaging deployment is present.
do $$
declare
  v_missing text;
begin
  -- SECURITY DEFINER functions must be created by the Supabase database owner.
  -- This prevents a lower-privileged deployment role from owning an otherwise
  -- privileged authorization surface. Supabase SQL-editor migrations run as
  -- postgres; stop rather than silently accepting a different owner.
  if current_user <> 'postgres' then
    raise exception 'Run this messaging migration as postgres so its SECURITY DEFINER functions are owned by postgres, not %.', current_user;
  end if;
  if to_regclass('public.gym_settings') is null
     or to_regclass('public.gym_staff') is null
     or to_regclass('public.member_account_links') is null then
    raise exception 'Messaging requires public.gym_settings, public.gym_staff, and public.member_account_links.';
  end if;

  select string_agg(required.name, ', ' order by required.name)
    into v_missing
  from (values
    ('gym_settings.id'), ('gym_settings.gym_name'),
    ('gym_staff.user_id'), ('gym_staff.gym_id'), ('gym_staff.role'), ('gym_staff.is_active'),
    ('member_account_links.user_id'), ('member_account_links.gym_id'),
    ('member_account_links.student_id'), ('member_account_links.status'),
    ('member_account_links.approved_at'), ('member_account_links.revoked_at')
  ) as required(name)
  where not exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = split_part(required.name, '.', 1)
      and c.column_name = split_part(required.name, '.', 2)
  );
  if v_missing is not null then
    raise exception 'Messaging prerequisite columns are missing: %', v_missing;
  end if;

  if not exists (
    select 1 from pg_constraint con
    where con.conrelid = 'public.gym_staff'::regclass
      and con.contype in ('p', 'u')
      and con.conkey = array[
        (select attnum from pg_attribute where attrelid = 'public.gym_staff'::regclass and attname = 'user_id' and not attisdropped),
        (select attnum from pg_attribute where attrelid = 'public.gym_staff'::regclass and attname = 'gym_id' and not attisdropped)
      ]::smallint[]
  ) then
    raise exception 'Messaging requires gym_staff unique key (user_id, gym_id).';
  end if;

  if to_regprocedure('auth.uid()') is null
     or to_regprocedure('gen_random_uuid()') is null
     or to_regprocedure('pg_catalog.hashtextextended(text,bigint)') is null
     or to_regprocedure('pg_catalog.pg_advisory_xact_lock(bigint)') is null then
    raise exception 'Messaging requires auth.uid(), gen_random_uuid(), hashtextextended(text,bigint), and pg_advisory_xact_lock(bigint).';
  end if;

  select string_agg(candidate.name, ', ' order by candidate.name)
    into v_missing
  from (values
    ('gym_staff_profiles'), ('family_staff_conversations'),
    ('family_staff_messages'), ('family_staff_conversation_reads'),
    ('family_staff_read_cursors')
  ) as candidate(name)
  where to_regclass('public.' || candidate.name) is not null;
  if v_missing is not null then
    raise exception 'Messaging relation collision(s): %. This is an initial migration and will not replace existing objects.', v_missing;
  end if;

  select string_agg(candidate.signature, ', ' order by candidate.signature)
    into v_missing
  from (values
    ('family_staff_is_active_staff(bigint)'),
    ('family_staff_is_active_admin(bigint)'),
    ('family_staff_is_approved_family(bigint)'),
    ('family_staff_require_conversation(bigint)'),
    ('family_staff_require_conversation(bigint,text)'),
    ('family_staff_resolve_inbox_label(bigint,bigint,uuid)'),
    ('family_staff_messages_immutable()'),
    ('family_staff_upsert_staff_profile(uuid,bigint,text)'),
    ('family_staff_get_or_create_conversation(bigint)'),
    ('family_staff_send_family_message(bigint,text,uuid)'),
    ('family_staff_send_staff_message(bigint,text,uuid)'),
    ('family_staff_list_family_conversations()'),
    ('family_staff_list_staff_conversations(bigint)'),
    ('family_staff_list_message_history(bigint,bigint,integer)'),
    ('family_staff_list_message_history(bigint,text,bigint,integer)'),
    ('family_staff_open_unread_page(bigint,integer)'),
    ('family_staff_open_unread_page(bigint,text,integer)'),
    ('family_staff_acknowledge_read(bigint,uuid,bigint)'),
    ('family_staff_acknowledge_read(bigint,text,uuid,bigint)'),
    ('family_staff_purge_expired_read_cursors(timestamptz)')
  ) as candidate(signature)
  where to_regprocedure('public.' || candidate.signature) is not null;
  if v_missing is not null then
    raise exception 'Messaging function collision(s): %. This is an initial migration and will not replace existing functions.', v_missing;
  end if;

end
$$;

create table public.gym_staff_profiles (
  user_id uuid not null,
  gym_id bigint not null,
  display_name text not null check (length(btrim(display_name)) between 1 and 120),
  updated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint gym_staff_profiles_pkey primary key (user_id, gym_id),
  constraint gym_staff_profiles_staff_fkey
    foreign key (user_id, gym_id)
    references public.gym_staff(user_id, gym_id) on delete restrict,
  constraint gym_staff_profiles_gym_fkey
    foreign key (gym_id) references public.gym_settings(id) on delete restrict
);

create table public.family_staff_conversations (
  id bigint generated always as identity primary key,
  gym_id bigint not null references public.gym_settings(id) on delete restrict,
  family_user_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint family_staff_conversations_scope_key unique (id, gym_id),
  constraint family_staff_conversations_family_gym_key unique (gym_id, family_user_id)
);

create table public.family_staff_messages (
  id bigint generated always as identity primary key,
  conversation_id bigint not null,
  gym_id bigint not null,
  sender_user_id uuid not null references auth.users(id) on delete restrict,
  sender_kind text not null check (sender_kind in ('family', 'staff')),
  sender_display_name text,
  body text not null check (length(btrim(body)) between 1 and 4000),
  idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  constraint family_staff_messages_conversation_fkey
    foreign key (conversation_id, gym_id)
    references public.family_staff_conversations(id, gym_id) on delete restrict,
  constraint family_staff_messages_id_conversation_key unique (id, conversation_id),
  constraint family_staff_messages_sender_retry_key unique (sender_user_id, idempotency_key)
);

create table public.family_staff_conversation_reads (
  conversation_id bigint not null,
  user_id uuid not null references auth.users(id) on delete restrict,
  access_role text not null check (access_role in ('family', 'staff')),
  last_read_message_id bigint,
  updated_at timestamptz not null default now(),
  constraint family_staff_conversation_reads_pkey primary key (conversation_id, user_id, access_role),
  constraint family_staff_conversation_reads_conversation_fkey
    foreign key (conversation_id) references public.family_staff_conversations(id) on delete restrict,
  constraint family_staff_conversation_reads_message_fkey
    foreign key (last_read_message_id, conversation_id)
    references public.family_staff_messages(id, conversation_id) on delete restrict
);

create table public.family_staff_read_cursors (
  id uuid primary key default gen_random_uuid(),
  conversation_id bigint not null,
  user_id uuid not null references auth.users(id) on delete restrict,
  access_role text not null check (access_role in ('family', 'staff')),
  base_read_message_id bigint,
  through_message_id bigint not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '15 minutes'),
  constraint family_staff_read_cursors_conversation_fkey
    foreign key (conversation_id) references public.family_staff_conversations(id) on delete restrict,
  constraint family_staff_read_cursors_endpoint_fkey
    foreign key (through_message_id, conversation_id)
    references public.family_staff_messages(id, conversation_id) on delete restrict,
  constraint family_staff_read_cursors_base_fkey
    foreign key (base_read_message_id, conversation_id)
    references public.family_staff_messages(id, conversation_id) on delete restrict,
  constraint family_staff_read_cursors_expiry_check check (expires_at > created_at)
);

create index family_staff_messages_conversation_time_idx
  on public.family_staff_messages (conversation_id, id desc);
create index family_staff_messages_gym_conversation_time_idx
  on public.family_staff_messages (gym_id, conversation_id, id desc);
create index family_staff_reads_user_conversation_idx
  on public.family_staff_conversation_reads (user_id, conversation_id, access_role, last_read_message_id);
create index family_staff_cursors_expiry_idx
  on public.family_staff_read_cursors (expires_at);

-- Internal authorization helpers. They have no authenticated execute grant.
create function public.family_staff_is_active_staff(p_gym_id bigint)
returns boolean language sql stable security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select auth.uid() is not null and exists (
    select 1 from public.gym_staff as gs
    where gs.user_id = auth.uid()
      and gs.gym_id = p_gym_id
      and gs.is_active = true
      and gs.role in ('admin', 'coach')
  );
$$;

create function public.family_staff_is_active_admin(p_gym_id bigint)
returns boolean language sql stable security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select auth.uid() is not null and exists (
    select 1 from public.gym_staff as gs
    where gs.user_id = auth.uid()
      and gs.gym_id = p_gym_id
      and gs.is_active = true and gs.role = 'admin'
  );
$$;

create function public.family_staff_is_approved_family(p_gym_id bigint)
returns boolean language sql stable security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select auth.uid() is not null and exists (
    select 1 from public.member_account_links as mal
    where mal.user_id = auth.uid() and mal.gym_id = p_gym_id
      and mal.status = 'approved' and mal.approved_at is not null
      and mal.revoked_at is null
  );
$$;

create function public.family_staff_require_conversation(
  p_conversation_id bigint,
  p_access_role text
)
returns public.family_staff_conversations
language plpgsql stable security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare v_conversation public.family_staff_conversations%rowtype;
begin
  if auth.uid() is null then raise exception 'Sign-in is required.' using errcode = '42501'; end if;
  if p_conversation_id is null then
    raise exception 'Conversation ID is required.' using errcode = '22023';
  end if;
  if p_access_role is null or p_access_role not in ('family','staff') then
    raise exception 'Access role must be family or staff.' using errcode = '22023';
  end if;
  select c.* into v_conversation from public.family_staff_conversations as c where c.id = p_conversation_id;
  if not found then raise exception 'Conversation was not found.' using errcode = 'P0002'; end if;

  if p_access_role = 'staff'
     and public.family_staff_is_active_staff(v_conversation.gym_id) then
    return v_conversation;
  end if;

  if p_access_role = 'family'
     and v_conversation.family_user_id = auth.uid()
     and public.family_staff_is_approved_family(v_conversation.gym_id) then
    return v_conversation;
  end if;

  raise exception 'You do not have access to this conversation.' using errcode = '42501';
end;
$$;

-- This helper is called only by the staff inbox RPC. It independently verifies
-- both the caller and supplied conversation scope. Phase 1 deliberately does
-- not consult Payment Tracking: a staff inbox must never disclose an account
-- label unless a future, separately reviewed authorization design proves that
-- the exact family account relationship is safe to reveal.
create function public.family_staff_resolve_inbox_label(
  p_conversation_id bigint, p_gym_id bigint, p_family_user_id uuid
) returns text
language plpgsql stable security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if p_conversation_id is null or p_gym_id is null or p_family_user_id is null then
    raise exception 'Conversation scope is required.' using errcode = '22023';
  end if;
  if not public.family_staff_is_active_staff(p_gym_id) then
    raise exception 'Active academy staff membership is required.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.family_staff_conversations as c
    where c.id = p_conversation_id and c.gym_id = p_gym_id and c.family_user_id = p_family_user_id
  ) then
    raise exception 'Conversation scope is invalid.' using errcode = '42501';
  end if;
  return 'Family account #' || p_conversation_id::text;
end;
$$;

create function public.family_staff_messages_immutable()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $$ begin raise exception 'Messages are immutable.' using errcode = '42501'; end; $$;

create trigger family_staff_messages_immutable_trigger
before update or delete on public.family_staff_messages
for each row execute function public.family_staff_messages_immutable();

-- Admin-only staff name management. A staff member cannot self-assign a label.
create function public.family_staff_upsert_staff_profile(p_user_id uuid, p_gym_id bigint, p_display_name text)
returns public.gym_staff_profiles language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare v_profile public.gym_staff_profiles%rowtype; v_name text := btrim(coalesce(p_display_name, ''));
begin
  if p_user_id is null or p_gym_id is null then raise exception 'Staff user and gym IDs are required.' using errcode = '22023'; end if;
  perform 1 from public.gym_staff as gs
  where gs.user_id=auth.uid() and gs.gym_id=p_gym_id and gs.is_active=true and gs.role='admin'
  for share;
  if not found then raise exception 'Active academy administrator membership is required.' using errcode = '42501'; end if;
  if length(v_name) not between 1 and 120 then raise exception 'Display name must contain 1 to 120 characters.' using errcode = '22023'; end if;
  if not exists (select 1 from public.gym_staff as gs where gs.user_id = p_user_id and gs.gym_id = p_gym_id) then raise exception 'Staff member was not found for this academy.' using errcode = 'P0002'; end if;
  insert into public.gym_staff_profiles as sp (user_id,gym_id,display_name,updated_by)
  values (p_user_id,p_gym_id,v_name,auth.uid())
  on conflict (user_id,gym_id) do update set display_name=excluded.display_name,updated_by=excluded.updated_by,updated_at=now()
  returning * into v_profile;
  return v_profile;
end;
$$;

create function public.family_staff_get_or_create_conversation(p_gym_id bigint)
returns table(conversation_id bigint, gym_id bigint, created_at timestamptz)
language plpgsql security definer set search_path = pg_catalog, public, pg_temp
as $$
declare v_conversation public.family_staff_conversations%rowtype;
begin
  if p_gym_id is null then raise exception 'Gym ID is required.' using errcode = '22023'; end if;
  -- Hold approved-link rows through the write so a concurrent revocation cannot
  -- pass an earlier authorization check and then complete this request.
  perform 1 from public.member_account_links as mal
  where mal.user_id=auth.uid() and mal.gym_id=p_gym_id and mal.status='approved'
    and mal.approved_at is not null and mal.revoked_at is null
  for share;
  if not found then raise exception 'An approved, non-revoked family link is required.' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text || ':' || p_gym_id::text, 0));
  if not public.family_staff_is_approved_family(p_gym_id) then raise exception 'An approved, non-revoked family link is required.' using errcode = '42501'; end if;
  select c.* into v_conversation from public.family_staff_conversations as c where c.gym_id=p_gym_id and c.family_user_id=auth.uid();
  if not found then
    insert into public.family_staff_conversations as c (gym_id,family_user_id) values (p_gym_id,auth.uid()) returning c.* into v_conversation;
  end if;
  return query select v_conversation.id, v_conversation.gym_id, v_conversation.created_at;
end;
$$;

create function public.family_staff_send_family_message(p_gym_id bigint, p_body text, p_idempotency_key uuid)
returns table(conversation_id bigint, message_id bigint, created_at timestamptz)
language plpgsql security definer set search_path = pg_catalog, public, pg_temp
as $$
declare v_body text:=btrim(coalesce(p_body,'')); v_message public.family_staff_messages%rowtype; v_conversation public.family_staff_conversations%rowtype;
begin
  if p_gym_id is null then raise exception 'Gym ID is required.' using errcode='22023'; end if;
  -- This lock makes authorization and the message write one revocation-safe
  -- transaction; lifecycle updates to the approved link wait until it ends.
  perform 1 from public.member_account_links as mal
  where mal.user_id=auth.uid() and mal.gym_id=p_gym_id and mal.status='approved'
    and mal.approved_at is not null and mal.revoked_at is null
  for share;
  if not found then raise exception 'An approved, non-revoked family link is required.' using errcode='42501'; end if;
  if p_idempotency_key is null or length(v_body) not between 1 and 4000 then raise exception 'A retry key and 1 to 4000 character message are required.' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text || ':' || p_idempotency_key::text,0));
  -- Recheck after the lock so a just-revoked link cannot complete a queued retry.
  if not public.family_staff_is_approved_family(p_gym_id) then raise exception 'An approved, non-revoked family link is required.' using errcode='42501'; end if;
  select m.* into v_message from public.family_staff_messages as m where m.sender_user_id=auth.uid() and m.idempotency_key=p_idempotency_key;
  if found then
    if v_message.sender_kind <> 'family' or v_message.gym_id <> p_gym_id or v_message.body is distinct from v_body then raise exception 'Retry key belongs to a different message context.' using errcode='22023'; end if;
    return query select v_message.conversation_id,v_message.id,v_message.created_at; return;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text || ':' || p_gym_id::text,0));
  if not public.family_staff_is_approved_family(p_gym_id) then raise exception 'An approved, non-revoked family link is required.' using errcode='42501'; end if;
  select c.* into v_conversation from public.family_staff_conversations as c where c.gym_id=p_gym_id and c.family_user_id=auth.uid();
  if not found then insert into public.family_staff_conversations as c (gym_id,family_user_id) values(p_gym_id,auth.uid()) returning c.* into v_conversation; end if;
  perform pg_advisory_xact_lock(v_conversation.id);
  insert into public.family_staff_messages as m (conversation_id,gym_id,sender_user_id,sender_kind,body,idempotency_key)
  values(v_conversation.id,p_gym_id,auth.uid(),'family',v_body,p_idempotency_key) returning m.* into v_message;
  return query select v_message.conversation_id,v_message.id,v_message.created_at;
end;
$$;

create function public.family_staff_send_staff_message(p_conversation_id bigint, p_body text, p_idempotency_key uuid)
returns table(conversation_id bigint, message_id bigint, created_at timestamptz)
language plpgsql security definer set search_path = pg_catalog, public, pg_temp
as $$
declare v_body text:=btrim(coalesce(p_body,'')); v_message public.family_staff_messages%rowtype; v_conversation public.family_staff_conversations%rowtype; v_label text;
begin
  if p_conversation_id is null then raise exception 'Conversation ID is required.' using errcode='22023'; end if;
  select c.* into v_conversation from public.family_staff_conversations as c where c.id=p_conversation_id;
  if not found then raise exception 'Conversation was not found.' using errcode='P0002'; end if;
  -- Hold the active membership row through the write and retry lookup. An
  -- administrator cannot deactivate the sender between authorization and insert.
  perform 1 from public.gym_staff as gs
  where gs.user_id=auth.uid() and gs.gym_id=v_conversation.gym_id
    and gs.is_active=true and gs.role in ('admin','coach')
  for share;
  if not found then raise exception 'Active academy staff membership is required.' using errcode='42501'; end if;
  if p_idempotency_key is null or length(v_body) not between 1 and 4000 then raise exception 'A retry key and 1 to 4000 character message are required.' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text || ':' || p_idempotency_key::text,0));
  -- Authorization is deliberately rechecked after acquiring the retry lock.
  if not public.family_staff_is_active_staff(v_conversation.gym_id) then raise exception 'Active academy staff membership is required.' using errcode='42501'; end if;
  select m.* into v_message from public.family_staff_messages as m where m.sender_user_id=auth.uid() and m.idempotency_key=p_idempotency_key;
  if found then
    if v_message.sender_kind <> 'staff' or v_message.conversation_id <> p_conversation_id or v_message.body is distinct from v_body then raise exception 'Retry key belongs to a different message context.' using errcode='22023'; end if;
    return query select v_message.conversation_id,v_message.id,v_message.created_at; return;
  end if;
  -- A revoked or no-longer-approved family keeps its historical conversation,
  -- but staff may not initiate or continue contact through this channel. This
  -- check is deliberately after the idempotency lookup: an active authorized
  -- staff member may safely recover the result of a prior successful request,
  -- while no new message can be inserted after revocation. Holding the link
  -- through the insert also serializes against a concurrent revocation.
  perform 1 from public.member_account_links as mal
  where mal.user_id=v_conversation.family_user_id and mal.gym_id=v_conversation.gym_id
    and mal.status='approved' and mal.approved_at is not null and mal.revoked_at is null
  for share;
  if not found then
    raise exception 'This family no longer has an approved link to this academy. The conversation is read-only.' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(v_conversation.id);
  select sp.display_name into v_label from public.gym_staff_profiles as sp where sp.user_id=auth.uid() and sp.gym_id=v_conversation.gym_id;
  insert into public.family_staff_messages as m (conversation_id,gym_id,sender_user_id,sender_kind,sender_display_name,body,idempotency_key)
  values(v_conversation.id,v_conversation.gym_id,auth.uid(),'staff',nullif(btrim(v_label),''),v_body,p_idempotency_key) returning m.* into v_message;
  return query select v_message.conversation_id,v_message.id,v_message.created_at;
end;
$$;

create function public.family_staff_list_family_conversations()
returns table(conversation_id bigint,gym_id bigint,gym_name text,latest_message_preview text,latest_sender_kind text,latest_message_at timestamptz,unread_count bigint)
language sql stable security definer set search_path = pg_catalog, public, pg_temp
as $$
  select c.id,c.gym_id,gs.gym_name, left(coalesce(latest.body,''),160),latest.sender_kind,latest.created_at,
    (select count(*) from public.family_staff_messages as um left join public.family_staff_conversation_reads as ur on ur.conversation_id=c.id and ur.user_id=auth.uid() and ur.access_role='family' where um.conversation_id=c.id and um.sender_kind='staff' and (ur.last_read_message_id is null or um.id>ur.last_read_message_id))
  from public.family_staff_conversations as c join public.gym_settings as gs on gs.id=c.gym_id
  left join lateral (select m.body,m.sender_kind,m.created_at from public.family_staff_messages as m where m.conversation_id=c.id order by m.id desc limit 1) as latest on true
  where c.family_user_id=auth.uid() and public.family_staff_is_approved_family(c.gym_id)
  order by latest.created_at desc nulls last,c.id desc;
$$;

create function public.family_staff_list_staff_conversations(p_gym_id bigint)
returns table(conversation_id bigint,gym_id bigint,family_label text,latest_message_preview text,latest_sender_kind text,latest_message_at timestamptz,unread_count bigint,can_reply boolean)
language plpgsql stable security definer set search_path = pg_catalog, public, pg_temp
as $$
begin
  if p_gym_id is null then raise exception 'Gym ID is required.' using errcode='22023'; end if;
  return query
  select c.id,c.gym_id,public.family_staff_resolve_inbox_label(c.id,c.gym_id,c.family_user_id),left(coalesce(latest.body,''),160),latest.sender_kind,latest.created_at,
    (select count(*) from public.family_staff_messages as um left join public.family_staff_conversation_reads as ur on ur.conversation_id=c.id and ur.user_id=auth.uid() and ur.access_role='staff' where um.conversation_id=c.id and um.sender_kind='family' and (ur.last_read_message_id is null or um.id>ur.last_read_message_id)),
    exists (select 1 from public.member_account_links as mal where mal.user_id=c.family_user_id and mal.gym_id=c.gym_id and mal.status='approved' and mal.approved_at is not null and mal.revoked_at is null)
  from public.family_staff_conversations as c
  left join lateral (select m.body,m.sender_kind,m.created_at from public.family_staff_messages as m where m.conversation_id=c.id order by m.id desc limit 1) as latest on true
  where c.gym_id=p_gym_id and public.family_staff_is_active_staff(p_gym_id)
  order by latest.created_at desc nulls last,c.id desc;
end;
$$;

create function public.family_staff_list_message_history(p_conversation_id bigint,p_access_role text,p_before_message_id bigint default null,p_page_size integer default 50)
returns table(message_id bigint,sender_kind text,sender_label text,body text,created_at timestamptz,has_more boolean)
language plpgsql stable security definer set search_path = pg_catalog, public, pg_temp
as $$
declare v_conversation public.family_staff_conversations%rowtype; v_limit integer; v_bound bigint;
begin
  v_conversation:=public.family_staff_require_conversation(p_conversation_id,p_access_role);
  if p_page_size is null or p_page_size not between 1 and 100 then raise exception 'Page size must be between 1 and 100.' using errcode='22023'; end if; v_limit:=p_page_size;
  if p_before_message_id is not null then
    select m.id into v_bound from public.family_staff_messages as m where m.id=p_before_message_id and m.conversation_id=v_conversation.id;
    if not found then raise exception 'Pagination boundary is not in this conversation.' using errcode='22023'; end if;
  end if;
  -- Select the newest requested rows first. Only then present that fixed page
  -- in chronological order, so the limit never accidentally selects the
  -- oldest rows before sorting and has_more reflects the same descending set.
  return query
  with newest_page as (
    select m.id,m.sender_kind,
      case when m.sender_kind='staff' then coalesce(m.sender_display_name,'Academy staff') else 'Family' end as sender_label,
      m.body,m.created_at
    from public.family_staff_messages as m
    where m.conversation_id=v_conversation.id
      and (p_before_message_id is null or m.id<p_before_message_id)
    order by m.id desc
    limit (v_limit + 1)
  ), selected_page as (
    select np.* from newest_page as np order by np.id desc limit v_limit
  ), page_metadata as (
    select count(*)>v_limit as has_more from newest_page
  )
  select sp.id,sp.sender_kind,sp.sender_label,sp.body,sp.created_at,pm.has_more
  from selected_page as sp cross join page_metadata as pm
  order by sp.id asc;
end;
$$;

create function public.family_staff_open_unread_page(p_conversation_id bigint,p_access_role text,p_page_size integer default 50)
returns table(read_cursor_id uuid,base_read_message_id bigint,through_message_id bigint,has_more boolean,messages jsonb)
language plpgsql security definer set search_path = pg_catalog, public, pg_temp
as $$
declare v_conversation public.family_staff_conversations%rowtype; v_base bigint; v_through bigint; v_more boolean; v_cursor uuid; v_messages jsonb; v_limit integer; v_incoming_sender_kind text;
begin
  v_conversation:=public.family_staff_require_conversation(p_conversation_id,p_access_role);
  v_incoming_sender_kind:=case when p_access_role='staff' then 'family' else 'staff' end;
  if p_page_size is null or p_page_size not between 1 and 100 then raise exception 'Page size must be between 1 and 100.' using errcode='22023'; end if; v_limit:=p_page_size;
  -- Every fresh message insert takes this same transaction-scoped advisory
  -- lock before it receives an identity value. The cursor is therefore issued
  -- from a committed, per-conversation serialization point: a later insert
  -- cannot have a lower message ID and cannot be skipped by acknowledgement.
  perform pg_advisory_xact_lock(v_conversation.id);
  insert into public.family_staff_conversation_reads as r(conversation_id,user_id,access_role) values(v_conversation.id,auth.uid(),p_access_role) on conflict(conversation_id,user_id,access_role) do nothing;
  -- Lock this role-specific marker through cursor issuance. An overlapping
  -- acknowledgement either waits and then makes this cursor stale, or sees
  -- the same marker; it cannot advance a marker past this page's endpoint.
  select r.last_read_message_id into v_base from public.family_staff_conversation_reads as r where r.conversation_id=v_conversation.id and r.user_id=auth.uid() and r.access_role=p_access_role for update;
  with page as (select m.id,m.sender_kind,case when m.sender_kind='staff' then coalesce(m.sender_display_name,'Academy staff') else 'Family' end as sender_label,m.body,m.created_at from public.family_staff_messages as m where m.conversation_id=v_conversation.id and m.sender_kind=v_incoming_sender_kind and (v_base is null or m.id>v_base) order by m.id asc limit (v_limit + 1)), trimmed as (select * from page order by id asc limit v_limit) select max(id),(select count(*)>v_limit from page),coalesce(jsonb_agg(jsonb_build_object('message_id',id,'sender_kind',sender_kind,'sender_label',sender_label,'body',body,'created_at',created_at) order by id),'[]'::jsonb) into v_through,v_more,v_messages from trimmed;
  if v_through is null then return query select null::uuid,v_base,null::bigint,false,'[]'::jsonb; return; end if;
  insert into public.family_staff_read_cursors as rc(conversation_id,user_id,access_role,base_read_message_id,through_message_id) values(v_conversation.id,auth.uid(),p_access_role,v_base,v_through) returning rc.id into v_cursor;
  return query select v_cursor,v_base,v_through,v_more,v_messages;
end;
$$;

create function public.family_staff_acknowledge_read(p_conversation_id bigint,p_access_role text,p_read_cursor_id uuid,p_through_message_id bigint)
returns table(last_read_message_id bigint,acknowledged_at timestamptz)
language plpgsql security definer set search_path = pg_catalog, public, pg_temp
as $$
declare v_conversation public.family_staff_conversations%rowtype; v_cursor public.family_staff_read_cursors%rowtype; v_read public.family_staff_conversation_reads%rowtype;
begin
  v_conversation:=public.family_staff_require_conversation(p_conversation_id,p_access_role);
  -- Serialize acknowledgement with unread-page issuance and new-message
  -- inserts for this conversation. This keeps the cursor endpoint and marker
  -- update on the same committed ordering boundary.
  perform pg_advisory_xact_lock(v_conversation.id);
  if p_read_cursor_id is null or p_through_message_id is null then raise exception 'Read cursor and endpoint are required.' using errcode='22023'; end if;
  select rc.* into v_cursor from public.family_staff_read_cursors as rc where rc.id=p_read_cursor_id and rc.user_id=auth.uid() and rc.conversation_id=v_conversation.id and rc.access_role=p_access_role;
  if not found then raise exception 'Read cursor is invalid for this user or conversation.' using errcode='22023'; end if;
  if v_cursor.expires_at<=now() then raise exception 'Read cursor has expired.' using errcode='22023'; end if;
  if p_through_message_id is distinct from v_cursor.through_message_id then raise exception 'Read acknowledgement must use the page endpoint issued by the server.' using errcode='22023'; end if;
  insert into public.family_staff_conversation_reads as r(conversation_id,user_id,access_role) values(v_conversation.id,auth.uid(),p_access_role) on conflict(conversation_id,user_id,access_role) do nothing;
  select r.* into v_read from public.family_staff_conversation_reads as r where r.conversation_id=v_conversation.id and r.user_id=auth.uid() and r.access_role=p_access_role for update;
  -- A transport retry of a successful acknowledgement is safe and does not
  -- move the marker. Any other changed marker is a stale concurrent request.
  if v_read.last_read_message_id is not distinct from v_cursor.through_message_id then
    return query select v_read.last_read_message_id,v_read.updated_at;
    return;
  end if;
  if v_read.last_read_message_id is distinct from v_cursor.base_read_message_id then raise exception 'Read marker changed; reload unread messages before acknowledging.' using errcode='40001'; end if;
  update public.family_staff_conversation_reads as r set last_read_message_id=v_cursor.through_message_id,updated_at=now() where r.conversation_id=v_conversation.id and r.user_id=auth.uid() and r.access_role=p_access_role returning r.* into v_read;
  return query select v_read.last_read_message_id,v_read.updated_at;
end;
$$;

-- No scheduled work is installed. An administrator may arrange a separate,
-- reviewed maintenance process to call this internal cleanup function.
create function public.family_staff_purge_expired_read_cursors(p_before timestamptz default now())
returns bigint language plpgsql security definer set search_path = pg_catalog, public, pg_temp
as $$ declare v_deleted bigint; begin delete from public.family_staff_read_cursors as rc where rc.expires_at<p_before; get diagnostics v_deleted=row_count; return v_deleted; end; $$;

alter table public.gym_staff_profiles enable row level security;
alter table public.family_staff_conversations enable row level security;
alter table public.family_staff_messages enable row level security;
alter table public.family_staff_conversation_reads enable row level security;
alter table public.family_staff_read_cursors enable row level security;
-- No direct policies: RLS remains default-deny and all client operations use
-- SECURITY DEFINER RPCs above after explicit authorization checks.

revoke all on table public.gym_staff_profiles, public.family_staff_conversations, public.family_staff_messages, public.family_staff_conversation_reads, public.family_staff_read_cursors from public, anon, authenticated;
revoke all on sequence public.family_staff_conversations_id_seq, public.family_staff_messages_id_seq from public, anon, authenticated;
revoke all on function public.family_staff_is_active_staff(bigint), public.family_staff_is_active_admin(bigint), public.family_staff_is_approved_family(bigint), public.family_staff_require_conversation(bigint,text), public.family_staff_resolve_inbox_label(bigint,bigint,uuid), public.family_staff_messages_immutable(), public.family_staff_purge_expired_read_cursors(timestamptz) from public, anon, authenticated;
revoke all on function public.family_staff_upsert_staff_profile(uuid,bigint,text), public.family_staff_get_or_create_conversation(bigint), public.family_staff_send_family_message(bigint,text,uuid), public.family_staff_send_staff_message(bigint,text,uuid), public.family_staff_list_family_conversations(), public.family_staff_list_staff_conversations(bigint), public.family_staff_list_message_history(bigint,text,bigint,integer), public.family_staff_open_unread_page(bigint,text,integer), public.family_staff_acknowledge_read(bigint,text,uuid,bigint) from public, anon, authenticated;
grant execute on function public.family_staff_upsert_staff_profile(uuid,bigint,text), public.family_staff_get_or_create_conversation(bigint), public.family_staff_send_family_message(bigint,text,uuid), public.family_staff_send_staff_message(bigint,text,uuid), public.family_staff_list_family_conversations(), public.family_staff_list_staff_conversations(bigint), public.family_staff_list_message_history(bigint,text,bigint,integer), public.family_staff_open_unread_page(bigint,text,integer), public.family_staff_acknowledge_read(bigint,text,uuid,bigint) to authenticated;

commit;
