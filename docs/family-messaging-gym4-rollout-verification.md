# Gym 4 messaging rollout verification plan

Status: review-only. Do not run the deployment or rollback scripts against Main or Test until the steps below are separately approved.

## Baseline manifest

The approved read-only Main inventory supplied the sixteen definition hashes, ACL hashes, and explicit (`false`) ACL-state values now embedded in the deployment manifest. Retain its output with the review record. A future inventory must again capture `pg_get_functiondef`, `md5(pg_get_functiondef)`, `pg_get_function_result`, language, volatility, `prosecdef`, owner, `proconfig`, `proacl`, `md5(coalesce(proacl::text, '<DEFAULT_ACL>'))`, and whether `proacl is null`; reject any signature outside the sixteen-function manifest before changing a value.

The reviewed inventory query is:

```sql
select p.oid::regprocedure::text as signature,
       pg_get_function_result(p.oid) as result_contract,
       l.lanname as language_name,
       p.provolatile,
       p.prosecdef as security_definer,
       pg_get_userbyid(p.proowner) as owner_name,
       p.proconfig as function_config,
       md5(pg_get_functiondef(p.oid)) as definition_md5,
       md5(coalesce(p.proacl::text, '<DEFAULT_ACL>')) as acl_md5,
       (p.proacl is null) as acl_is_default,
       p.proacl as raw_acl
from pg_proc p
join pg_language l on l.oid = p.prolang
where p.pronamespace = 'public'::regnamespace
  and p.proname like 'family_staff_%'
order by p.oid::regprocedure::text;
```

Review the result against the sixteen signatures in the script, rather than accepting the name pattern as the manifest: it deliberately reveals unexpected overloads too. This query is an inventory only; it must be separately authorized before use against Main.

The preflight verifies the same metadata and hash again inside the deployment transaction. It creates the backup only after this comparison succeeds.

## Disposable PostgreSQL contract validation

Use a fresh disposable PostgreSQL database matching the intended Supabase major version. Install only the extensions needed by Phase 1, create minimal `auth.uid()` and dependent table stubs, then apply the reviewed Phase 1 migration. Capture the sixteen-function manifest and paste it into a disposable copy of the rollout script.

Validate all of the following before Main review:

1. The deployment script parses and commits with the six replacement functions and one private helper.
2. `family_staff_list_family_conversations()` retains its exact return contract: seven columns, in order, with `bigint, bigint, text, text, text, timestamptz, bigint`. Compare empty, one-row, ordering, and unread-count results against the SQL original using the same fixtures.
3. Exercise all nine public messaging RPCs: staff-profile upsert; get-or-create conversation; family send; staff send; family inbox; staff inbox; paged history; unread-page cursor; and acknowledgement. Gym 4 authorized family/staff fixtures must preserve the original revocation-lock, idempotency-key, unread-cursor, and acknowledgement behavior.
4. For each public RPC, verify other-gym denial and opposite-role denial where that role is not authorized. Each authorization denial, including the family inbox without an approved, non-revoked Gym 4 family link, must return SQLSTATE `42501`. Confirm the private helper has no `PUBLIC`, `anon`, or `authenticated` execute privilege and its schema has no API-role usage.
5. Concurrent approved-link revocation continues to block new send/create operations exactly as Phase 1 required; retries, cursors, and acknowledgements remain unchanged for Gym 4.
6. The rollback preflight rejects a deliberate post-deployment replacement of any backed-up function, the Gym 4 helper, or the private-schema ACL, then succeeds after restoring the expected rollout definition. Verify every baseline hash, owner, search path, return contract, and raw ACL/null-ACL state after rollback.

## Main rollout order

1. Keep normal Messaging navigation and the production capability disabled.
2. Complete the approved read-only Main manifest, review all sixteen values, and populate the deployment script.
3. Run the disposable validation above using the exact populated script.
4. Obtain separate approval for Main deployment. Do not use the completed controlled-test run as a deployment test and do not reset it.
5. After deployment, perform only the separately approved authorization and durable-client-retry tests. Retain the private backup through the full rollout verification period.
6. Consider enabling production messaging only after migration verification, durable retry persistence, navigation, and remaining authorization tests are complete. Backup cleanup requires a separate review and is not part of rollback.
