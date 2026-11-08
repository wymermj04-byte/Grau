# Promotion Notifications — Gym 4 rollout-control runbook

This runbook is for a trusted Main Supabase database operator only. It does not
authorize a rollout. The operator's authenticated SQL Editor identity/session
is the actual executor; `p_actor_user_id` is an accountable administrator
reference recorded for audit and is not cryptographic proof of who ran SQL.

## Preconditions

1. The controller migration has passed its `session_user = 'postgres'` and
   `postgres BYPASSRLS` preflight checks.
2. The Phase 2 worker and promotion integration have been deployed and the
   read-only verification package reports Gym 4 disabled.
3. A separate activation approval names the human operator, accountable
   administrator UUID, reason, and a new UUID request ID.

## State rules

- The migration itself creates no `gym_notification_rollouts` row.
- A first **disabled** controller call provisions a disabled row and records a
  `provision_disabled` audit event. It is not an activation/deactivation
  transition.
- Every enable sets a fresh `generation_floor_at` from the database clock.
  This intentional policy excludes both historical promotions and promotions
  recorded during any disabled interval. Only promotions with a later
  database-assigned `promotion_effective_at` qualify.
- A repeated request with the same request UUID is idempotent and returns its
  immutable original outcome plus the separately named current state, without
  another audit event or transition. If later transitions occurred, the result
  marks that the original request no longer matches the current state.
- Reusing a request UUID with a different requested state, accountable actor,
  or normalized reason fails closed and creates no audit event.
- A repeated state request with a new UUID records an immutable `noop` audit
  event but does not alter the rollout row.

## Activation and deactivation

Use only the private function
`grau_promotion_notifications_private.set_gym4_promotion_notification_rollout`
from the trusted `postgres` session. It accepts the desired boolean state, the
accountable administrator UUID, an operational reason, and a request UUID.
The function cannot control another gym and is not granted to browser,
authenticated, anonymous, or `service_role` roles.

After each call, run the read-only Phase 2 deployment verification SQL. Verify
the Gym 4 state, `generation_floor_at`, and the aggregate control-event count.

## Problem response

Stop scheduler invocations first. Then use the same trusted controller to
disable Gym 4 with a new request UUID and reason. Preserve outbox, event,
recipient, inbox, and rollout-control audit records; do not delete or rewrite
them. Do not rely on a separate SQL Editor request to close an abandoned
transaction—explicitly end the original session/transaction before treating a
failed operation as complete.
