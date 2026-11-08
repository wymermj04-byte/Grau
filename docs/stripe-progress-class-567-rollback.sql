-- REVIEW ONLY — DO NOT DEPLOY WITHOUT EXPLICIT APPROVAL.
--
-- Guarded rollback for stripe-progress-class-567-deployment.sql.
-- It restores the exact saved definition only when the deployed definition
-- and every protected metadata field still match the deployment baseline.
-- It retains the private backup after rollback and deletes no application data.

begin;

do $$
declare
  v_backup grau_stripe_progress_private.get_gym_stripe_progress_context_backup%rowtype;
  v_oid oid;
  v_current_md5 text;
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
  select *
    into v_backup
  from grau_stripe_progress_private.get_gym_stripe_progress_context_backup
  where function_signature = 'public.get_gym_stripe_progress_context()'
  for update;

  if not found
     or v_backup.post_deployment_definition_md5 is null then
    raise exception
      'Rollback refused: no complete deployment backup exists.';
  end if;

  v_oid := to_regprocedure('public.get_gym_stripe_progress_context()');

  if v_oid is null then
    raise exception
      'Rollback refused: deployed function is missing.';
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
    v_current_md5,
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

  if v_current_md5 is distinct from v_backup.post_deployment_definition_md5 then
    raise exception
      'Rollback refused: function definition changed after deployment.';
  end if;

  if v_signature is distinct from v_backup.function_signature
     or v_identity_arguments is distinct from v_backup.original_identity_arguments
     or v_return_type is distinct from v_backup.original_return_type
     or v_language is distinct from v_backup.original_language
     or v_volatility is distinct from v_backup.original_volatility
     or v_security_definer is distinct from v_backup.original_security_definer
     or v_owner is distinct from v_backup.original_owner
     or v_config is distinct from v_backup.original_search_path
     or v_raw_acl is distinct from v_backup.original_raw_acl
  then
    raise exception
      'Rollback refused: protected function metadata or privileges differ from the deployment baseline.';
  end if;

  execute v_backup.original_definition;

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
    v_current_md5,
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
  where p.oid = to_regprocedure('public.get_gym_stripe_progress_context()');

  if v_current_md5 is distinct from v_backup.original_definition_md5
     or v_signature is distinct from v_backup.function_signature
     or v_identity_arguments is distinct from v_backup.original_identity_arguments
     or v_return_type is distinct from v_backup.original_return_type
     or v_language is distinct from v_backup.original_language
     or v_volatility is distinct from v_backup.original_volatility
     or v_security_definer is distinct from v_backup.original_security_definer
     or v_owner is distinct from v_backup.original_owner
     or v_config is distinct from v_backup.original_search_path
     or v_raw_acl is distinct from v_backup.original_raw_acl
  then
    raise exception
      'Rollback verification failed: original function contract was not restored exactly.';
  end if;
end;
$$;

commit;
