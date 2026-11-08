-- REVIEW ONLY — DO NOT DEPLOY WITHOUT SEPARATE APPROVAL.
--
-- Phase 2 independent components. This adds no rollout row, does not change
-- public attendance, students, Promotions, thresholds, or record_student_promotion.
-- It is safe only after the Phase 1 private schema contract is verified.

begin;

do $$
declare
  promotion_relation oid;
begin
  if to_regnamespace('grau_promotion_notifications_private') is null
    or to_regclass('grau_promotion_notifications_private.gym_notification_rollouts') is null
    or to_regclass('grau_promotion_notifications_private.promotion_notification_outbox') is null
    or to_regclass('grau_promotion_notifications_private.promotion_outbox_recipients') is null
    or to_regclass('grau_promotion_notifications_private.notification_events') is null
    or to_regclass('grau_promotion_notifications_private.notification_inbox') is null
    or to_regclass('public.member_account_links') is null
    or to_regclass('public.gym_staff') is null
    or to_regclass('public."Promotions"') is null then
    raise exception 'Phase 2 requires the verified Phase 1 notification foundation and reviewed source tables.';
  end if;

  if to_regprocedure('gen_random_uuid()') is null then
    raise exception 'Phase 2 requires gen_random_uuid() for non-guessable worker leases.';
  end if;

  if not exists (
    select 1 from pg_roles where rolname = 'postgres' and rolbypassrls
  ) then
    raise exception 'The postgres SECURITY DEFINER owner must have BYPASSRLS for FORCE RLS private notification tables.';
  end if;

  -- Every column below is referenced directly by this migration. Validate it
  -- through catalogs so a drifted Phase 1/public contract fails before any
  -- Phase 2 routine is created.
  if exists (
    select 1
    from (values
      ('public', 'member_account_links', 'id', 'bigint'),
      ('public', 'member_account_links', 'gym_id', 'bigint'),
      ('public', 'member_account_links', 'student_id', 'bigint'),
      ('public', 'member_account_links', 'user_id', 'uuid'),
      ('public', 'member_account_links', 'status', 'text'),
      ('public', 'member_account_links', 'revoked_at', 'timestamp with time zone'),
      ('public', 'gym_staff', 'gym_id', 'bigint'),
      ('public', 'gym_staff', 'user_id', 'uuid'),
      ('public', 'gym_staff', 'is_active', 'boolean'),
      ('public', 'gym_staff', 'role', 'text'),
      ('public', 'Promotions', 'id', 'bigint'),
      ('public', 'Promotions', 'gym_id', 'bigint'),
      ('public', 'Promotions', 'student_id', 'bigint'),
      ('public', 'Promotions', 'promotion_effective_at', 'timestamp with time zone'),
      ('grau_promotion_notifications_private', 'gym_notification_rollouts', 'gym_id', 'bigint'),
      ('grau_promotion_notifications_private', 'gym_notification_rollouts', 'enabled', 'boolean'),
      ('grau_promotion_notifications_private', 'gym_notification_rollouts', 'generation_floor_at', 'timestamp with time zone'),
      ('grau_promotion_notifications_private', 'promotion_notification_outbox', 'id', 'bigint'),
      ('grau_promotion_notifications_private', 'promotion_notification_outbox', 'gym_id', 'bigint'),
      ('grau_promotion_notifications_private', 'promotion_notification_outbox', 'student_id', 'bigint'),
      ('grau_promotion_notifications_private', 'promotion_notification_outbox', 'promotion_id', 'bigint'),
      ('grau_promotion_notifications_private', 'promotion_notification_outbox', 'notification_kind', 'text'),
      ('grau_promotion_notifications_private', 'promotion_notification_outbox', 'state', 'text'),
      ('grau_promotion_notifications_private', 'promotion_notification_outbox', 'attempt_count', 'integer'),
      ('grau_promotion_notifications_private', 'promotion_notification_outbox', 'next_attempt_at', 'timestamp with time zone'),
      ('grau_promotion_notifications_private', 'promotion_notification_outbox', 'lease_token', 'uuid'),
      ('grau_promotion_notifications_private', 'promotion_notification_outbox', 'lease_expires_at', 'timestamp with time zone'),
      ('grau_promotion_notifications_private', 'promotion_notification_outbox', 'last_error_code', 'text'),
      ('grau_promotion_notifications_private', 'promotion_notification_outbox', 'last_error_at', 'timestamp with time zone'),
      ('grau_promotion_notifications_private', 'promotion_notification_outbox', 'delivered_at', 'timestamp with time zone'),
      ('grau_promotion_notifications_private', 'promotion_notification_outbox', 'created_at', 'timestamp with time zone'),
      ('grau_promotion_notifications_private', 'promotion_notification_outbox', 'updated_at', 'timestamp with time zone'),
      ('grau_promotion_notifications_private', 'promotion_outbox_recipients', 'outbox_id', 'bigint'),
      ('grau_promotion_notifications_private', 'promotion_outbox_recipients', 'gym_id', 'bigint'),
      ('grau_promotion_notifications_private', 'promotion_outbox_recipients', 'student_id', 'bigint'),
      ('grau_promotion_notifications_private', 'promotion_outbox_recipients', 'family_user_id', 'uuid'),
      ('grau_promotion_notifications_private', 'promotion_outbox_recipients', 'member_account_link_id', 'bigint'),
      ('grau_promotion_notifications_private', 'notification_events', 'id', 'bigint'),
      ('grau_promotion_notifications_private', 'notification_events', 'gym_id', 'bigint'),
      ('grau_promotion_notifications_private', 'notification_events', 'student_id', 'bigint'),
      ('grau_promotion_notifications_private', 'notification_events', 'event_kind', 'text'),
      ('grau_promotion_notifications_private', 'notification_events', 'promotion_outbox_id', 'bigint'),
      ('grau_promotion_notifications_private', 'notification_events', 'payload', 'jsonb'),
      ('grau_promotion_notifications_private', 'notification_inbox', 'id', 'bigint'),
      ('grau_promotion_notifications_private', 'notification_inbox', 'event_id', 'bigint'),
      ('grau_promotion_notifications_private', 'notification_inbox', 'gym_id', 'bigint'),
      ('grau_promotion_notifications_private', 'notification_inbox', 'student_id', 'bigint'),
      ('grau_promotion_notifications_private', 'notification_inbox', 'recipient_user_id', 'uuid'),
      ('grau_promotion_notifications_private', 'notification_inbox', 'recipient_role', 'text'),
      ('grau_promotion_notifications_private', 'notification_inbox', 'read_at', 'timestamp with time zone')
    ) as expected(schema_name, table_name, column_name, expected_type)
    left join pg_namespace as namespace on namespace.nspname = expected.schema_name
    left join pg_class as relation on relation.relnamespace = namespace.oid and relation.relname = expected.table_name
    left join pg_attribute as attribute
      on attribute.attrelid = relation.oid
      and attribute.attname = expected.column_name
      and attribute.attnum > 0
      and not attribute.attisdropped
    where relation.oid is null
      or attribute.attnum is null
      or format_type(attribute.atttypid, attribute.atttypmod) <> expected.expected_type
  ) then
    raise exception 'A Phase 2 source column is missing or has an unexpected type.';
  end if;

  if exists (
    select 1
    from (values
      ('grau_promotion_notifications_private', 'promotion_notification_outbox', 'promotion_notification_outbox_promotion_kind_key'),
      ('grau_promotion_notifications_private', 'promotion_outbox_recipients', 'promotion_outbox_recipients_outbox_user_key'),
      ('grau_promotion_notifications_private', 'notification_events', 'notification_events_celebration_once_key'),
      ('grau_promotion_notifications_private', 'notification_inbox', 'notification_inbox_recipient_key')
    ) as expected(schema_name, table_name, constraint_name)
    left join pg_namespace as namespace on namespace.nspname = expected.schema_name
    left join pg_class as relation on relation.relnamespace = namespace.oid and relation.relname = expected.table_name
    left join pg_constraint as con on con.conrelid = relation.oid and con.conname = expected.constraint_name
    where con.oid is null
  ) then
    raise exception 'A Phase 1 unique constraint required for idempotency is missing.';
  end if;

  if exists (
    select 1
    from (values
      ('promotion_notification_outbox_due_idx'),
      ('promotion_outbox_recipients_family_lookup_idx'),
      ('notification_events_gym_created_idx'),
      ('notification_inbox_recipient_unread_idx')
    ) as expected(index_name)
    left join pg_class as index_relation on index_relation.relname = expected.index_name and index_relation.relkind = 'i'
    left join pg_namespace as namespace on namespace.oid = index_relation.relnamespace and namespace.nspname = 'grau_promotion_notifications_private'
    where namespace.oid is null
  ) then
    raise exception 'A reviewed Phase 1 reconciliation or lookup index is missing.';
  end if;

  if exists (
    select 1
    from (values
      ('promotion_notification_outbox', 'promotion_notification_outbox_validate_insert'),
      ('promotion_notification_outbox', 'promotion_notification_outbox_guard_mutation'),
      ('promotion_outbox_recipients', 'promotion_outbox_recipients_validate_insert'),
      ('promotion_outbox_recipients', 'promotion_outbox_recipients_immutable'),
      ('notification_events', 'notification_events_validate_insert'),
      ('notification_events', 'notification_events_immutable'),
      ('notification_inbox', 'notification_inbox_validate_insert'),
      ('notification_inbox', 'notification_inbox_guard_mutation')
    ) as expected(table_name, trigger_name)
    left join pg_namespace as namespace on namespace.nspname = 'grau_promotion_notifications_private'
    left join pg_class as relation on relation.relnamespace = namespace.oid and relation.relname = expected.table_name
    left join pg_trigger as trigger_row
      on trigger_row.tgrelid = relation.oid
      and trigger_row.tgname = expected.trigger_name
      and not trigger_row.tgisinternal
      and trigger_row.tgenabled <> 'D'
    where trigger_row.oid is null
  ) then
    raise exception 'A reviewed Phase 1 validation or immutability trigger is missing or disabled.';
  end if;

  if exists (
    select 1
    from pg_class as relation
    join pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'grau_promotion_notifications_private'
      and relation.relkind = 'r'
      and (not relation.relrowsecurity or not relation.relforcerowsecurity or pg_get_userbyid(relation.relowner) <> 'postgres')
  ) or exists (
    select 1 from pg_policy as policy
    join pg_class as relation on relation.oid = policy.polrelid
    join pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'grau_promotion_notifications_private'
  ) then
    raise exception 'Private notification tables must remain postgres-owned, FORCE RLS protected, and policy-free.';
  end if;

  if exists (
    select 1
    from pg_namespace as namespace
    cross join lateral aclexplode(coalesce(namespace.nspacl, acldefault('n', namespace.nspowner))) as acl
    left join pg_roles as grantee on grantee.oid = acl.grantee
    where namespace.nspname = 'grau_promotion_notifications_private'
      and (acl.grantee = 0 or grantee.rolname in ('anon', 'authenticated', 'service_role'))
  ) or exists (
    select 1
    from pg_class as relation
    join pg_namespace as namespace on namespace.oid = relation.relnamespace
    cross join lateral aclexplode(coalesce(relation.relacl, acldefault('r', relation.relowner))) as acl
    left join pg_roles as grantee on grantee.oid = acl.grantee
    where namespace.nspname = 'grau_promotion_notifications_private'
      and relation.relkind in ('r', 'S')
      and (acl.grantee = 0 or grantee.rolname in ('anon', 'authenticated', 'service_role'))
  ) or exists (
    select 1
    from pg_proc as proc
    join pg_namespace as namespace on namespace.oid = proc.pronamespace
    cross join lateral aclexplode(coalesce(proc.proacl, acldefault('f', proc.proowner))) as acl
    left join pg_roles as grantee on grantee.oid = acl.grantee
    where namespace.nspname = 'grau_promotion_notifications_private'
      and (acl.grantee = 0 or grantee.rolname in ('anon', 'authenticated', 'service_role'))
  ) then
    raise exception 'Private notification schema objects must not grant browser or service roles access.';
  end if;

  promotion_relation := to_regclass('public."Promotions"');
  if not exists (
    select 1
    from pg_trigger as trigger_row
    join pg_proc as proc on proc.oid = trigger_row.tgfoid
    where trigger_row.tgrelid = promotion_relation
      and not trigger_row.tgisinternal
      and trigger_row.tgenabled <> 'D'
      and pg_get_functiondef(proc.oid) like '%promotion_effective_at%'
      and pg_get_functiondef(proc.oid) like '%promotion_track_at_promotion%'
  ) then
    raise exception 'The reviewed promotion timestamp/track snapshot trigger is missing or disabled.';
  end if;

  if not exists (
    select 1
    from pg_proc as proc
    where proc.oid = to_regprocedure('grau_promotion_notifications_private.guard_outbox_mutation()')
      and pg_get_userbyid(proc.proowner) = 'postgres'
      and proc.prosecdef
      and proc.proconfig @> array['search_path=pg_catalog, pg_temp']
      and pg_get_functiondef(proc.oid) like '%if tg_op = ''DELETE'' then%'
      and pg_get_functiondef(proc.oid) like '%old.id is distinct from new.id%'
      and pg_get_functiondef(proc.oid) like '%old.gym_id is distinct from new.gym_id%'
      and pg_get_functiondef(proc.oid) like '%old.student_id is distinct from new.student_id%'
      and pg_get_functiondef(proc.oid) like '%old.promotion_id is distinct from new.promotion_id%'
      and pg_get_functiondef(proc.oid) like '%old.notification_kind is distinct from new.notification_kind%'
      and pg_get_functiondef(proc.oid) like '%old.created_at is distinct from new.created_at%'
      and pg_get_functiondef(proc.oid) like '%return new%'
  ) then
    raise exception 'The verified Phase 1 outbox mutation guard contract does not match the reviewed immutable-identity definition.';
  end if;

  if exists (
    select 1
    from pg_proc proc
    join pg_namespace namespace on namespace.oid = proc.pronamespace
    where (namespace.nspname, proc.proname) in (
      ('grau_promotion_notifications_private', 'enqueue_verified_promotion_celebration'),
      ('grau_promotion_notifications_private', 'require_gym4_notification_rollout'),
      ('grau_promotion_notifications_private', 'require_gym4_notification_staff'),
      ('public', 'process_gym4_promotion_notification_outbox'),
      ('public', 'family_promotion_notification_inbox'),
      ('public', 'mark_family_promotion_notification_read'),
      ('public', 'staff_promotion_notification_inbox'),
      ('public', 'mark_staff_promotion_notification_read')
    )
  ) then
    raise exception 'One or more Phase 2 routines already exist; stop and inventory the partial deployment.';
  end if;
end
$$;

-- Returns false for all disabled/non-Gym-4 cases. Unexpected data-integrity
-- failures propagate to the caller; an official promotion and its durable
-- outbox intent cannot commit independently once integration is enabled.
create function grau_promotion_notifications_private.enqueue_verified_promotion_celebration(
  p_promotion_id bigint,
  p_gym_id bigint,
  p_student_id bigint,
  p_promotion_effective_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, grau_promotion_notifications_private, pg_temp
as $$
declare
  rollout grau_promotion_notifications_private.gym_notification_rollouts%rowtype;
begin
  if p_gym_id <> 4 then
    return false;
  end if;

  select * into rollout
  from grau_promotion_notifications_private.gym_notification_rollouts as current_rollout
  where current_rollout.gym_id = 4
  -- Serialize with activation/deactivation; KEY SHARE would not block an
  -- enabled-state UPDATE on this non-key column.
  for share;

  if not found or not rollout.enabled or rollout.generation_floor_at is null then
    return false;
  end if;

  if p_promotion_effective_at is null
    or p_promotion_effective_at <= rollout.generation_floor_at then
    return false;
  end if;

  if not exists (
    select 1
    from public."Promotions" as promotion
    where promotion.id = p_promotion_id
      and promotion.gym_id = p_gym_id
      and promotion.student_id = p_student_id
      and promotion.promotion_effective_at = p_promotion_effective_at
  ) then
    raise exception 'The verified promotion snapshot does not match the requested notification outbox source.'
      using errcode = '23514';
  end if;

  insert into grau_promotion_notifications_private.promotion_notification_outbox (
    gym_id, student_id, promotion_id, notification_kind
  ) values (
    4, p_student_id, p_promotion_id, 'promotion_celebration'
  )
  on conflict (promotion_id, notification_kind) do nothing;

  return true;
end;
$$;

alter function grau_promotion_notifications_private.enqueue_verified_promotion_celebration(bigint, bigint, bigint, timestamptz) owner to postgres;

create function grau_promotion_notifications_private.require_gym4_notification_rollout()
returns void
language plpgsql
security definer
set search_path = pg_catalog, grau_promotion_notifications_private, pg_temp
as $$
begin
  perform 1
  from grau_promotion_notifications_private.gym_notification_rollouts as rollout
  where rollout.gym_id = 4
    and rollout.enabled
    and rollout.generation_floor_at is not null
  for share;
  if not found then
    raise exception 'Promotion notifications are not enabled for this gym.' using errcode = '42501';
  end if;
end;
$$;

alter function grau_promotion_notifications_private.require_gym4_notification_rollout() owner to postgres;

create function grau_promotion_notifications_private.require_gym4_notification_staff()
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, auth, pg_temp
as $$
begin
  if auth.uid() is null or not exists (
    select 1
    from public.gym_staff as staff
    where staff.gym_id = 4
      and staff.user_id = auth.uid()
      and staff.is_active
      and staff.role in ('admin', 'coach')
  ) then
    raise exception 'An active Gym 4 administrator or coach membership is required.' using errcode = '42501';
  end if;
end;
$$;

alter function grau_promotion_notifications_private.require_gym4_notification_staff() owner to postgres;

-- This is the only worker entry point. An Edge Function with a verified secret
-- invokes it using the service_role key; no browser role receives EXECUTE.
create function public.process_gym4_promotion_notification_outbox(p_limit integer default 25)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth, grau_promotion_notifications_private, pg_temp
as $$
declare
  current_outbox grau_promotion_notifications_private.promotion_notification_outbox%rowtype;
  event_id bigint;
  lease uuid;
  attempt_after_claim integer;
  worker_error_code text;
  recovered_exhausted_rows integer := 0;
  processed integer := 0;
  delivered integer := 0;
  retried integer := 0;
  dead_lettered integer := 0;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Only the trusted notification worker may process promotion outbox rows.' using errcode = '42501';
  end if;
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception 'p_limit must be between 1 and 100.' using errcode = '22023';
  end if;

  perform grau_promotion_notifications_private.require_gym4_notification_rollout();

  -- A crashed worker may leave a lease behind. Five attempts is exhausted:
  -- recover that row to a terminal non-processing state before candidate
  -- selection so it can never be claimed for a sixth delivery attempt.
  with exhausted as (
    select outbox.id, outbox.state
    from grau_promotion_notifications_private.promotion_notification_outbox as outbox
    where outbox.gym_id = 4
      and outbox.attempt_count >= 5
      and (
        outbox.state in ('pending', 'retry_scheduled')
        or (outbox.state = 'processing' and outbox.lease_expires_at <= now())
      )
    for update skip locked
  )
  update grau_promotion_notifications_private.promotion_notification_outbox as outbox
  set state = 'dead_letter',
      lease_token = null,
      lease_expires_at = null,
      last_error_code = case
        when exhausted.state = 'processing' then 'lease_expired'
        else 'attempts_exhausted'
      end,
      last_error_at = now(),
      updated_at = now()
  from exhausted
  where outbox.id = exhausted.id;
  get diagnostics recovered_exhausted_rows = row_count;
  dead_lettered := dead_lettered + recovered_exhausted_rows;

  for current_outbox in
    select outbox.*
    from grau_promotion_notifications_private.promotion_notification_outbox as outbox
    join grau_promotion_notifications_private.gym_notification_rollouts as rollout
      on rollout.gym_id = outbox.gym_id
    where outbox.gym_id = 4
      and rollout.enabled
      and rollout.generation_floor_at is not null
      and outbox.attempt_count < 5
      and (
        (outbox.state in ('pending', 'retry_scheduled') and outbox.next_attempt_at <= now())
        or (outbox.state = 'processing' and outbox.lease_expires_at <= now())
      )
    order by outbox.next_attempt_at, outbox.id
    for update of outbox skip locked
    limit p_limit
  loop
    lease := gen_random_uuid();
    update grau_promotion_notifications_private.promotion_notification_outbox as outbox
    set state = 'processing',
        attempt_count = outbox.attempt_count + 1,
        lease_token = lease,
        lease_expires_at = now() + interval '5 minutes',
        updated_at = now()
    where outbox.id = current_outbox.id;
    processed := processed + 1;

    begin
      event_id := null;
      insert into grau_promotion_notifications_private.promotion_outbox_recipients (
        outbox_id, gym_id, student_id, family_user_id, member_account_link_id
      )
      select current_outbox.id, 4, current_outbox.student_id, member_link.user_id, member_link.id
      from public.member_account_links as member_link
      where member_link.gym_id = 4
        and member_link.student_id = current_outbox.student_id
        and member_link.status = 'approved'
        and member_link.revoked_at is null
      on conflict (outbox_id, family_user_id) do nothing;

      insert into grau_promotion_notifications_private.notification_events (
        gym_id, student_id, event_kind, promotion_outbox_id, payload
      ) values (
        4,
        current_outbox.student_id,
        'promotion_celebration',
        current_outbox.id,
        jsonb_build_object('promotion_id', current_outbox.promotion_id)
      )
      on conflict (promotion_outbox_id) do nothing
      returning id into event_id;

      if event_id is null then
        select event.id into event_id
        from grau_promotion_notifications_private.notification_events as event
        where event.promotion_outbox_id = current_outbox.id
        for key share;
      end if;

      insert into grau_promotion_notifications_private.notification_inbox (
        event_id, gym_id, student_id, recipient_user_id, recipient_role
      )
      select event_id, 4, current_outbox.student_id, recipient.family_user_id, 'family'
      from grau_promotion_notifications_private.promotion_outbox_recipients as recipient
      where recipient.outbox_id = current_outbox.id
        and exists (
          select 1
          from public.member_account_links as current_link
          where current_link.user_id = recipient.family_user_id
            and current_link.gym_id = 4
            and current_link.student_id = current_outbox.student_id
            and current_link.status = 'approved'
            and current_link.revoked_at is null
        )
      on conflict (event_id, recipient_user_id, recipient_role) do nothing;

      update grau_promotion_notifications_private.promotion_notification_outbox as outbox
      set state = 'delivered',
          delivered_at = now(),
          lease_token = null,
          lease_expires_at = null,
          last_error_code = null,
          last_error_at = null,
          updated_at = now()
      where outbox.id = current_outbox.id
        and outbox.lease_token = lease;
      delivered := delivered + 1;
    exception when others then
      get stacked diagnostics worker_error_code = returned_sqlstate;
      update grau_promotion_notifications_private.promotion_notification_outbox as outbox
      set state = case when outbox.attempt_count >= 5 then 'dead_letter' else 'retry_scheduled' end,
          next_attempt_at = case
            when outbox.attempt_count >= 5 then outbox.next_attempt_at
            else now() + make_interval(secs => least(3600, 30 * (2 ^ least(outbox.attempt_count - 1, 6))::integer))
          end,
          lease_token = null,
          lease_expires_at = null,
          last_error_code = worker_error_code,
          last_error_at = now(),
          updated_at = now()
      where outbox.id = current_outbox.id
        and outbox.lease_token = lease
      returning outbox.attempt_count into attempt_after_claim;
      if not found then
        raise exception 'Outbox lease was lost while recording a worker failure.' using errcode = '40001';
      end if;
      if attempt_after_claim >= 5 then dead_lettered := dead_lettered + 1; else retried := retried + 1; end if;
    end;
  end loop;

  return jsonb_build_object(
    'processed', processed,
    'delivered', delivered,
    'retried', retried,
    'dead_lettered', dead_lettered
  );
end;
$$;

alter function public.process_gym4_promotion_notification_outbox(integer) owner to postgres;

create function public.family_promotion_notification_inbox(p_limit integer default 50)
returns table(notification_id bigint, student_id bigint, event_kind text, created_at timestamptz, read_at timestamptz)
language plpgsql
security definer
set search_path = pg_catalog, public, auth, grau_promotion_notifications_private, pg_temp
as $$
begin
  if p_limit is null or p_limit not between 1 and 100 then raise exception 'p_limit must be between 1 and 100.' using errcode = '22023'; end if;
  perform grau_promotion_notifications_private.require_gym4_notification_rollout();
  if auth.uid() is null then raise exception 'Authentication is required.' using errcode = '42501'; end if;
  return query
  select inbox.id, inbox.student_id, event.event_kind, inbox.created_at, inbox.read_at
  from grau_promotion_notifications_private.notification_inbox as inbox
  join grau_promotion_notifications_private.notification_events as event on event.id = inbox.event_id
  join grau_promotion_notifications_private.promotion_outbox_recipients as recipient
    on recipient.outbox_id = event.promotion_outbox_id and recipient.family_user_id = inbox.recipient_user_id
  where inbox.gym_id = 4
    and inbox.recipient_role = 'family'
    and inbox.recipient_user_id = auth.uid()
    and exists (
      select 1
      from public.member_account_links as current_link
      where current_link.user_id = auth.uid()
        and current_link.gym_id = 4
        and current_link.student_id = inbox.student_id
        and current_link.status = 'approved'
        and current_link.revoked_at is null
    )
  order by inbox.created_at desc, inbox.id desc
  limit p_limit;
end;
$$;

alter function public.family_promotion_notification_inbox(integer) owner to postgres;

create function public.mark_family_promotion_notification_read(p_notification_id bigint)
returns table(notification_id bigint, read_at timestamptz)
language plpgsql
security definer
set search_path = pg_catalog, public, auth, grau_promotion_notifications_private, pg_temp
as $$
declare
  current_inbox grau_promotion_notifications_private.notification_inbox%rowtype;
begin
  perform grau_promotion_notifications_private.require_gym4_notification_rollout();
  if auth.uid() is null then raise exception 'Authentication is required.' using errcode = '42501'; end if;
  select inbox.* into current_inbox
  from grau_promotion_notifications_private.notification_inbox as inbox
  where inbox.id = p_notification_id and inbox.gym_id = 4 and inbox.recipient_role = 'family'
    and inbox.recipient_user_id = auth.uid()
    and exists (
      select 1 from grau_promotion_notifications_private.notification_events as event
      join grau_promotion_notifications_private.promotion_outbox_recipients as recipient
        on recipient.outbox_id = event.promotion_outbox_id and recipient.family_user_id = auth.uid()
      where event.id = inbox.event_id
        and exists (
          select 1
          from public.member_account_links as current_link
          where current_link.user_id = auth.uid()
            and current_link.gym_id = 4
            and current_link.student_id = inbox.student_id
            and current_link.status = 'approved'
            and current_link.revoked_at is null
        )
    )
  for update;
  if not found then raise exception 'Notification not found.' using errcode = '42501'; end if;
  if current_inbox.read_at is null then
    update grau_promotion_notifications_private.notification_inbox as inbox
    set read_at = now()
    where inbox.id = current_inbox.id
      and inbox.read_at is null
    returning inbox.read_at into current_inbox.read_at;
  end if;
  return query select current_inbox.id, current_inbox.read_at;
end;
$$;

alter function public.mark_family_promotion_notification_read(bigint) owner to postgres;

create function public.staff_promotion_notification_inbox(p_limit integer default 50)
returns table(notification_id bigint, student_id bigint, event_kind text, created_at timestamptz, read_at timestamptz)
language plpgsql
security definer
set search_path = pg_catalog, public, auth, grau_promotion_notifications_private, pg_temp
as $$
begin
  if p_limit is null or p_limit not between 1 and 100 then raise exception 'p_limit must be between 1 and 100.' using errcode = '22023'; end if;
  perform grau_promotion_notifications_private.require_gym4_notification_rollout();
  perform grau_promotion_notifications_private.require_gym4_notification_staff();
  return query
  select inbox.id, inbox.student_id, event.event_kind, inbox.created_at, inbox.read_at
  from grau_promotion_notifications_private.notification_inbox as inbox
  join grau_promotion_notifications_private.notification_events as event on event.id = inbox.event_id
  where inbox.gym_id = 4 and inbox.recipient_role = 'staff' and inbox.recipient_user_id = auth.uid()
  order by inbox.created_at desc, inbox.id desc limit p_limit;
end;
$$;

alter function public.staff_promotion_notification_inbox(integer) owner to postgres;

create function public.mark_staff_promotion_notification_read(p_notification_id bigint)
returns table(notification_id bigint, read_at timestamptz)
language plpgsql
security definer
set search_path = pg_catalog, public, auth, grau_promotion_notifications_private, pg_temp
as $$
declare current_inbox grau_promotion_notifications_private.notification_inbox%rowtype;
begin
  perform grau_promotion_notifications_private.require_gym4_notification_rollout();
  perform grau_promotion_notifications_private.require_gym4_notification_staff();
  select inbox.* into current_inbox from grau_promotion_notifications_private.notification_inbox as inbox
  where inbox.id = p_notification_id and inbox.gym_id = 4 and inbox.recipient_role = 'staff'
    and inbox.recipient_user_id = auth.uid() for update;
  if not found then raise exception 'Notification not found.' using errcode = '42501'; end if;
  if current_inbox.read_at is null then
    update grau_promotion_notifications_private.notification_inbox as inbox
    set read_at = now()
    where inbox.id = current_inbox.id
      and inbox.read_at is null
    returning inbox.read_at into current_inbox.read_at;
  end if;
  return query select current_inbox.id, current_inbox.read_at;
end;
$$;

alter function public.mark_staff_promotion_notification_read(bigint) owner to postgres;

revoke all on function grau_promotion_notifications_private.enqueue_verified_promotion_celebration(bigint, bigint, bigint, timestamptz) from public, anon, authenticated, service_role;
revoke all on function grau_promotion_notifications_private.require_gym4_notification_rollout() from public, anon, authenticated, service_role;
revoke all on function grau_promotion_notifications_private.require_gym4_notification_staff() from public, anon, authenticated, service_role;
revoke all on function public.process_gym4_promotion_notification_outbox(integer) from public, anon, authenticated;
grant execute on function public.process_gym4_promotion_notification_outbox(integer) to service_role;
revoke all on function public.family_promotion_notification_inbox(integer) from public, anon, service_role;
grant execute on function public.family_promotion_notification_inbox(integer) to authenticated;
revoke all on function public.mark_family_promotion_notification_read(bigint) from public, anon, service_role;
grant execute on function public.mark_family_promotion_notification_read(bigint) to authenticated;
revoke all on function public.staff_promotion_notification_inbox(integer) from public, anon, service_role;
grant execute on function public.staff_promotion_notification_inbox(integer) to authenticated;
revoke all on function public.mark_staff_promotion_notification_read(bigint) from public, anon, service_role;
grant execute on function public.mark_staff_promotion_notification_read(bigint) to authenticated;

commit;
