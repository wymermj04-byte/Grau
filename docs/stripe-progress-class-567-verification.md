# Class 567 stripe-progress deployment verification

> Review-only runbook. No query in this document has been run against Main or Test Supabase.

## Preconditions

- The deployment transaction has committed successfully.
- The verifier is signed in as the existing Gym 4 admin or coach with exactly one active staff membership.
- The verification is performed through that real authenticated app session, not by setting or impersonating JWT claims in SQL.

## Catalog verification

Run this read-only query as the deployment operator. The function MD5 is expected to differ from the pre-deployment value because the Class 567 correction intentionally changes the definition. All remaining values must match the listed values.

```sql
begin read only;

select
  md5(pg_get_functiondef(
    to_regprocedure('public.get_gym_stripe_progress_context()')
  )) as deployed_definition_md5,
  pg_get_userbyid(p.proowner) as owner,
  l.lanname as language,
  p.provolatile as volatility,
  p.prosecdef as security_definer,
  p.proconfig as function_settings,
  pg_get_function_result(p.oid) as return_type,
  p.proacl::text as raw_acl
from pg_proc p
join pg_language l on l.oid = p.prolang
where p.oid = to_regprocedure('public.get_gym_stripe_progress_context()');

commit;
```

Expected values:

- owner: `postgres`
- language: `plpgsql`
- volatility: `s` (stable)
- security_definer: `true`
- function_settings: `{search_path=pg_catalog, public, pg_temp}`
- return_type: `jsonb`
- raw_acl: `{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}`

## Authenticated Gym 4 RPC-output verification

With the real Gym 4 staff session active, use the app's existing Stripe Progress load. It calls `get_gym_stripe_progress_context()` through the signed-in Supabase session. Inspect the response using this field-level read-only check in the same authenticated request context:

```sql
begin read only;

with rpc_result as (
  select public.get_gym_stripe_progress_context() as payload
),
class_567 as (
  select class_item.value
  from rpc_result r
  cross join lateral jsonb_array_elements(r.payload -> 'classes') as class_item(value)
  where (class_item.value ->> 'id')::bigint = 567
),
exception_567 as (
  select exception_item.value
  from rpc_result r
  cross join lateral jsonb_array_elements(
    r.payload -> 'class_contract_exceptions'
  ) as exception_item(value)
  where (exception_item.value ->> 'id')::bigint = 567
)
select
  (select count(*) from class_567) = 1
    as class_567_appears_exactly_once,
  coalesce((
    select bool_and(value ->> 'scheduled_class_day' = '2026-09-20')
    from class_567
  ), false)
    as class_567_day_is_2026_09_20,
  coalesce((
    select bool_and(
      value ? 'scheduled_start_at'
      and value -> 'scheduled_start_at' = 'null'::jsonb
    )
    from class_567
  ), false)
    as class_567_start_is_null,
  not exists (select 1 from exception_567)
    as class_567_absent_from_exceptions,
  (
    select jsonb_array_length(payload -> 'class_contract_exceptions') = 0
    from rpc_result
  ) as gym_4_exception_array_is_empty;

commit;
```

Expected result: all five columns are `true`.

This verification is read-only. It does not alter classes, attendance, promotions, baselines, thresholds, messaging, or feature flags.
