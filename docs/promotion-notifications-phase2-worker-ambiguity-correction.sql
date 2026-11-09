-- REVIEW ONLY — Grau Zero Promotion Notifications worker ambiguity correction.
-- Do not execute until the deployed function definition has been independently
-- compared with this reviewed source and deployment is explicitly approved.
--
-- Scope: only public.process_gym4_promotion_notification_outbox(integer).
-- This does not touch outbox rows, promotions, family links, notification
-- events, inbox rows, rollout state, grants, ownership, or worker scheduling.
--
-- Suspected 42702 source in the reviewed deployed/local function:
--
--   insert into grau_promotion_notifications_private.notification_inbox (...)
--   select event_id, 4, current_outbox.student_id, ...
--
-- `event_id` is both a PL/pgSQL variable and a column of the INSERT target.
-- Rename the variable to `v_event_id`, including this SELECT expression.

begin;

-- REQUIRED: Replace only this sentinel with the independently reviewed value
-- returned by:
--
--   select md5(pg_get_functiondef(
--     'public.process_gym4_promotion_notification_outbox(integer)'::regprocedure
--   ));
--
-- Do not derive it from this file. The sentinel deliberately prevents a
-- deployment until the reviewed Main value is recorded here.
create temporary table grau_promotion_worker_ambiguity_baseline (
  definition_md5 text not null,
  owner_oid oid not null,
  security_definer boolean not null,
  function_config text[] null,
  function_acl aclitem[] null
) on commit drop;

-- Fail closed unless the complete deployed definition exactly matches the
-- independently reviewed pre-correction definition. The catalog values saved
-- here are compared again after replacement to prove that owner, SECURITY
-- DEFINER, SET configuration, and explicit/default EXECUTE ACL state remain
-- unchanged.
do $$
declare
  v_definition text;
  v_expected_definition_md5 constant text := '__REPLACE_WITH_REVIEWED_PRECORRECTION_DEFINITION_MD5__';
  v_owner_oid oid;
  v_security_definer boolean;
  v_function_config text[];
  v_function_acl aclitem[];
begin
  if v_expected_definition_md5 like '__REPLACE_%__' then
    raise exception 'Populate the independently reviewed pre-correction worker definition MD5 before deployment.';
  end if;

  select
    pg_get_functiondef(proc.oid),
    proc.proowner,
    proc.prosecdef,
    proc.proconfig,
    proc.proacl
    into
      v_definition,
      v_owner_oid,
      v_security_definer,
      v_function_config,
      v_function_acl
  from pg_proc as proc
  where proc.oid = to_regprocedure(
    'public.process_gym4_promotion_notification_outbox(integer)'
  );

  if v_definition is null then
    raise exception 'Promotion notification worker RPC is missing.';
  end if;

  if md5(v_definition) <> v_expected_definition_md5 then
    raise exception 'Live worker definition MD5 differs from the independently reviewed pre-correction definition; stop for definition review.';
  end if;

  insert into pg_temp.grau_promotion_worker_ambiguity_baseline (
    definition_md5,
    owner_oid,
    security_definer,
    function_config,
    function_acl
  ) values (
    v_expected_definition_md5,
    v_owner_oid,
    v_security_definer,
    v_function_config,
    v_function_acl
  );
end
$$;

-- The only intended source change below is event_id -> v_event_id for the
-- PL/pgSQL local variable and its references. CREATE OR REPLACE preserves
-- the existing function identity, ownership, and EXECUTE ACLs.
create or replace function public.process_gym4_promotion_notification_outbox(p_limit integer default 25)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth, grau_promotion_notifications_private, pg_temp
as $$
declare
  current_outbox grau_promotion_notifications_private.promotion_notification_outbox%rowtype;
  v_event_id bigint;
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
      v_event_id := null;
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
      returning id into v_event_id;

      if v_event_id is null then
        select event.id into v_event_id
        from grau_promotion_notifications_private.notification_events as event
        where event.promotion_outbox_id = current_outbox.id
        for key share;
      end if;

      insert into grau_promotion_notifications_private.notification_inbox (
        event_id, gym_id, student_id, recipient_user_id, recipient_role
      )
      select v_event_id, 4, current_outbox.student_id, recipient.family_user_id, 'family'
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

-- Post-replacement verification is inside the same transaction. Any missing
-- corrected reference, retained ambiguous SELECT, or drift in owner/security/
--configuration/ACLs aborts the transaction and restores the old function.
do $$
declare
  v_definition text;
  v_owner_oid oid;
  v_security_definer boolean;
  v_function_config text[];
  v_function_acl aclitem[];
  v_baseline pg_temp.grau_promotion_worker_ambiguity_baseline%rowtype;
begin
  select * into v_baseline
  from pg_temp.grau_promotion_worker_ambiguity_baseline;

  if not found then
    raise exception 'Worker correction baseline is missing; transaction cannot be verified.';
  end if;

  select
    pg_get_functiondef(proc.oid),
    proc.proowner,
    proc.prosecdef,
    proc.proconfig,
    proc.proacl
    into
      v_definition,
      v_owner_oid,
      v_security_definer,
      v_function_config,
      v_function_acl
  from pg_proc as proc
  where proc.oid = to_regprocedure(
    'public.process_gym4_promotion_notification_outbox(integer)'
  );

  if v_definition is null
    or position('v_event_id bigint;' in lower(v_definition)) = 0
    or position('v_event_id := null;' in lower(v_definition)) = 0
    or position('returning id into v_event_id;' in lower(v_definition)) = 0
    or position('if v_event_id is null then' in lower(v_definition)) = 0
    or position('select event.id into v_event_id' in lower(v_definition)) = 0
    or position('select v_event_id, 4, current_outbox.student_id' in lower(v_definition)) = 0
    or position('select event_id, 4, current_outbox.student_id' in lower(v_definition)) > 0
    or position('on conflict (event_id, recipient_user_id, recipient_role) do nothing' in lower(v_definition)) = 0
    or v_owner_oid is distinct from v_baseline.owner_oid
    or v_security_definer is distinct from v_baseline.security_definer
    or v_function_config is distinct from v_baseline.function_config
    or v_function_acl is distinct from v_baseline.function_acl
  then
    raise exception 'Worker correction post-replacement verification failed; transaction will roll back.';
  end if;
end
$$;

commit;
