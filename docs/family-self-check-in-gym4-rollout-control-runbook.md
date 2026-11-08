# Gym 4 Family Self-Check-In rollout control — review-only runbook

This runbook is for a separately approved November 10, 2026 launch. It does not authorize SQL execution, app deployment, environment changes, or rollout activation.

## Preconditions

1. Run `family-self-check-in-gym4-rollout-control-verification.sql` after the rollout-control migration is deployed. Existing `gym_rollouts` must have RLS enabled; its FORCE RLS setting is observed but is not required because confirmed `postgres` has `BYPASSRLS`. The control function must be `SECURITY DEFINER`, owned by `postgres`, and unavailable to `anon`, `authenticated`, `service_role`, and `PUBLIC`. Its new audit table must have both RLS and FORCE RLS enabled.
2. Run the existing base self-check-in verification package. Confirm the six public request/approval RPCs, their grants, attendance uniqueness, and attendance classification trigger match the reviewed contract.
3. Confirm Gym 4 uses `America/New_York` and that classes 577 and 578 remain Scheduled, inactive, correctly audience-classified, and qualifying.
4. Publish a production build only after separately authorizing `EXPO_PUBLIC_FAMILY_SELF_CHECK_IN_GYM4_ENABLED=true`. This client setting merely exposes the Gym 4 route; it never enables Main Supabase.
5. Before deployment, use the verification script to confirm that the SQL Editor reports `session_user = postgres` and that the `postgres` role has `rolsuper` or `rolbypassrls`. Supabase SQL Editor behavior is an environment assumption, not something the migration can prove in advance; stop if either result differs.
6. Select an active Gym 4 administrator as the accountable application actor. The trusted database administrator supplies that UUID only to the private control function. It is an accountable administrator reference, not cryptographic proof of the person operating SQL Editor. Record the actual trusted database operator, time, change approval, and reason separately in the approved change record. Do not use an arbitrary UUID or a coach identity for rollout control.

## Enable Gym 4

At or after 5:45 PM EST for Kids Gi, or 6:45 PM EST for Adult Gi, a trusted database administrator may run the reviewed private procedure in Main Supabase SQL Editor:

```sql
select *
from grau_self_check_in_private.set_gym4_self_check_in_rollout(
  true,
  '<active-gym-4-admin-uuid>',
  'Approved November 10, 2026 Gym 4 family self-check-in launch.'
);
```

Expected result: one row for Gym 4 with `enabled = true`, `changed = true`, and a non-null audit event ID. A repeated enable call is idempotent: it returns `changed = false` and creates no duplicate audit event.

Immediately run the read-only verification script. Confirm one Gym 4 rollout row, `ENABLED`, activation metadata present, and no unexpected grants.

Families then submit pending requests. Staff must approve or decline them; a family request must not create attendance.

## Disable / emergency rollback

If requests, authorization, attendance verification, or staff approval behaves unexpectedly, stop accepting requests by disabling Gym 4 immediately:

```sql
select *
from grau_self_check_in_private.set_gym4_self_check_in_rollout(
  false,
  '<active-gym-4-admin-uuid>',
  'Emergency disable: investigate before re-enabling.'
);
```

Expected result: Gym 4 returns `enabled = false`, `changed = true`, and an immutable deactivation event is appended. Existing requests and attendance are retained; this procedure never deletes or changes them. Repeated disable calls are idempotent and do not add duplicate audit events.

Run the read-only verification script again. Confirm `DISABLED`, deactivation metadata present, and preserve the audit history for review. If a disabled row has zero audit events and no disable metadata, it is the intentional fail-closed provisioning state, not a missing deactivation audit.

## Boundaries

- The procedure controls only Gym 4. It has no gym parameter and cannot enable another academy.
- Only the `postgres` database-owner role can execute it. Browser roles and `service_role` receive no grant.
- The procedure records the SQL database session role and an active Gym 4 administrator as the accountable actor reference; the external change record identifies the human operator.
- This procedure does not publish QR codes, change classes, create requests, insert attendance, alter promotion counting, or change payments, messaging, or Alerts.
