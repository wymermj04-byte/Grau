-- REVIEW ONLY — rollback for family-messaging-gym4-rollout-deployment.sql.
-- Do not execute until deployment has been verified and an operator has
-- approved rollback. The private backup and helper metadata are intentionally
-- retained afterward.

begin;

do $$
declare v_problem text;
begin
  if to_regclass('grau_messaging_private.family_messaging_rollout_backup') is null then
    raise exception 'Gym 4 rollout backup is missing.';
  end if;
  if to_regclass('grau_messaging_private.family_messaging_rollout_metadata') is null then
    raise exception 'Gym 4 rollout metadata is missing.';
  end if;
  if current_user <> 'postgres' then
    raise exception 'Run this reviewed SECURITY DEFINER rollback only as postgres.';
  end if;
  if (select count(*) from grau_messaging_private.family_messaging_rollout_backup where migration_key='gym4-rollout-v1') <> 16 then
    raise exception 'Gym 4 rollout backup is incomplete.';
  end if;
  if (select count(*) from grau_messaging_private.family_messaging_rollout_metadata where migration_key='gym4-rollout-v1') <> 1 then
    raise exception 'Gym 4 rollout helper metadata is incomplete.';
  end if;

  -- Stored backup text must still match the exact approved baseline hash before
  -- it can be executed. This detects backup-table tampering independently of
  -- the live post-rollout function checks below.
  select string_agg(b.signature, ', ' order by b.signature) into v_problem
  from grau_messaging_private.family_messaging_rollout_backup b
  where b.migration_key='gym4-rollout-v1'
    and (b.baseline_definition_md5<>b.approved_baseline_definition_md5
      or md5(b.baseline_definition)<>b.approved_baseline_definition_md5);
  if v_problem is not null then
    raise exception 'Rollback blocked: stored baseline hash mismatch: %', v_problem;
  end if;

  -- Abort if anything changed after the rollout. Do not overwrite a later
  -- review, repair, or emergency change with stale backup definitions.
  select string_agg(b.signature, ', ' order by b.signature) into v_problem
  from grau_messaging_private.family_messaging_rollout_backup b
  left join pg_proc p on p.oid=to_regprocedure('public.' || b.signature)
  left join pg_language l on l.oid=p.prolang
  where b.migration_key='gym4-rollout-v1'
    and (p.oid is null or b.post_definition_md5 is null
      or md5(pg_get_functiondef(p.oid))<>b.post_definition_md5
      or l.lanname is distinct from b.post_language
      or p.provolatile is distinct from b.post_volatility
      or p.prosecdef is distinct from b.post_security_definer
      or p.proowner is distinct from b.post_owner
      or p.proconfig is distinct from b.post_config
      or pg_get_function_result(p.oid) is distinct from b.post_result
      or p.proacl is distinct from b.post_acl
      or (p.proacl is null) is distinct from b.post_acl_is_default);
  if v_problem is not null then
    raise exception 'Rollback blocked: post-deployment function hash mismatch: %', v_problem;
  end if;

  -- The helper is also part of the deployed contract. A changed helper or
  -- schema ACL must be reviewed, not silently dropped by a stale rollback.
  if exists (
    select 1
    from grau_messaging_private.family_messaging_rollout_metadata b
    left join pg_proc p on p.oid=to_regprocedure(b.helper_signature)
    left join pg_language l on l.oid=p.prolang
    join pg_namespace n on n.oid='grau_messaging_private'::regnamespace
    where b.migration_key='gym4-rollout-v1'
      and (p.oid is null
        or md5(pg_get_functiondef(p.oid))<>b.helper_definition_md5
        or l.lanname<>b.helper_language
        or p.provolatile<>b.helper_volatility
        or p.prosecdef<>b.helper_security_definer
        or p.proowner<>b.helper_owner
        or p.proconfig is distinct from b.helper_config
        or p.proacl is distinct from b.helper_acl
        or (p.proacl is null)<>b.helper_acl_is_default
        or n.nspacl is distinct from b.private_schema_acl
        or (n.nspacl is null)<>b.private_schema_acl_is_default)
  ) then
    raise exception 'Rollback blocked: deployed Gym 4 helper or private schema changed.';
  end if;
end
$$;

-- The stored definitions use CREATE OR REPLACE. Existing function OIDs,
-- owners, and ACLs are retained; no grant reconstruction is performed. This
-- is intentional: it preserves an explicit ACL exactly as explicit and a
-- NULL/default ACL exactly as default. PUBLIC is never treated as a quoted
-- role during rollback.
do $$
declare r record;
begin
  for r in
    select baseline_definition
    from grau_messaging_private.family_messaging_rollout_backup
    where migration_key='gym4-rollout-v1'
    order by signature
  loop
    execute r.baseline_definition;
  end loop;
end
$$;

drop function grau_messaging_private.family_staff_gym4_rollout_enabled(bigint);

do $$
declare v_problem text;
begin
  select string_agg(b.signature, ', ' order by b.signature) into v_problem
  from grau_messaging_private.family_messaging_rollout_backup b
  left join pg_proc p on p.oid=to_regprocedure('public.' || b.signature)
  left join pg_language l on l.oid=p.prolang
  where b.migration_key='gym4-rollout-v1'
    and (p.oid is null
      or md5(pg_get_functiondef(p.oid))<>b.baseline_definition_md5
      or l.lanname<>b.baseline_language
      or p.provolatile<>b.baseline_volatility
      or p.prosecdef<>b.baseline_security_definer
      or p.proowner<>b.baseline_owner
      or p.proconfig is distinct from b.baseline_config
      or pg_get_function_result(p.oid)<>b.baseline_result
      or p.proacl is distinct from b.baseline_acl
      or (p.proacl is null)<>b.baseline_acl_is_default);
  if v_problem is not null then
    raise exception 'Rollback verification failed: %', v_problem;
  end if;
end
$$;

-- Keep the private backup and helper metadata. They have no
-- PUBLIC/anon/authenticated grants and remain the audit/rollback record until
-- a separate cleanup review explicitly removes them.
commit;
