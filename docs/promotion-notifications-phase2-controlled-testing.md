# Promotion Notifications — Gym 4 controlled test package

This package is a test checklist, not authorization to create promotions,
activate the rollout, or deploy the worker. Promotion thresholds, attendance,
payments, messaging, and Family Self-Check-In are out of scope.

## Read-only checks while disabled

1. Run `promotion-notifications-phase2-deployment-verification.sql` as the
   trusted database operator.
2. Confirm the promotion integration reports its fixed `SECURITY DEFINER`
   configuration, uses `enqueue_verified_promotion_celebration`, captures the
   inserted promotion ID, and reads `promotion_effective_at`.
3. Confirm Gym 4 has zero enabled rollout rows and all Gym 4 notification
   aggregate counts are zero before any controlled test.
4. Confirm private enqueue access is false for `anon`, `authenticated`, and
   `service_role`; the worker is executable only by `service_role`; inbox RPCs
   are executable only by `authenticated`.
5. POST to the deployed worker only from the trusted operator/scheduler after
   separate approval. While disabled, expect `{ ok: true, disabled: true }`
   and no outbox, event, recipient, or inbox count change.
6. Confirm an approved Gym 4 family account cannot access staff inbox results,
   and an active Gym 4 coach/admin cannot access family inbox results. These
   are authenticated, read-only RPC checks and require separate authorization.

## Controlled activation test — requires explicit approval

1. Stop scheduled worker invocations.
2. Capture the read-only baseline: rollout state, generation floor, control
   audit count, and aggregate notification counts.
3. From the trusted `postgres` session only, activate through
   `set_gym4_promotion_notification_rollout(true, actor_uuid, reason,
   request_uuid)`. Record the returned database-assigned generation floor.
4. Create exactly one newly authorized Gym 4 promotion only after that floor;
   record the promotion ID and timestamp. Do not reuse historical promotions.
5. Run the worker once through the trusted Edge Function. Expect one outbox
   row, one event, and at most one inbox row per currently approved,
   unrevoked family link. Re-run it and verify counts do not increase.
6. Sign in separately as the approved family account. Verify only its linked
   student’s notification is listed; mark it read; repeat the mark-read call
   and verify the same read state without a duplicate inbox row.
7. Sign in separately as an active Gym 4 coach/admin. Verify only Gym 4 staff
   results are returned. Do not use a family account as a staff account.
8. For retry/lease recovery, use only a separately approved database fixture
   procedure. Verify attempts stop at five and exhausted rows become
   `dead_letter` with cleared lease fields. Never hand-edit private rows.
9. Revoke a test family link only under separate approval. Verify the existing
   immutable recipient snapshot remains auditable while that account can no
   longer list or mark the notification read.
10. Deactivate through the controller with a new request UUID and reason.
    Confirm the audit event, disabled state, preserved records, and worker’s
    `{ ok: true, disabled: true }` response.

## Pass conditions

- No notification originates from a historical promotion at or before the
  generation floor.
- One official promotion yields no more than one celebration outbox identity,
  event, and inbox identity per recipient.
- Unauthorized, cross-gym, revoked-link, and disabled-rollout access fails
  closed.
- Worker retries are bounded to five claims, leases are cleared on terminal
  states, and notification reads are idempotent.

## Stop conditions

Stop immediately, disable Gym 4 through the controller, stop scheduler
invocations, and preserve all audit/outbox records if any private-table grant,
cross-gym result, duplicate event, sixth processing attempt, or unexpected
promotion failure is observed.
