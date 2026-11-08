# Promotion Alerts Phase 2 — Main deployment checklist

Notifications must remain disabled throughout this checklist. These are the
only Main Supabase actions required before controlled testing; none is
authorized by creating this document.

1. In Main SQL Editor, run the read-only
   `promotion-notifications-phase2-live-contract-inventory.sql`. Save the full
   `pg_get_functiondef` result for `record_student_promotion`.
2. Compare that result with
   `promotion-notifications-phase2-record-promotion-integration-comparison.md`
   and the integration SQL. Resolve any difference before proceeding. In
   particular, do not assume the chat-copied `normalized_type` line is wrong.
3. Confirm the Phase 1 schema and all seven private tables exist, remain RLS
   enabled and forced, and that Gym 4 has zero rollout rows and zero enabled
   rows.
4. Review and deploy the Gym 4 rollout-control migration. It must complete
   without creating a rollout row. Its control function is private,
   `postgres`-session-only, unauthorised for browser roles, and creates an
   immutable audit record for a later controlled state change.
5. Review and deploy the independent Phase 2 SQL migration. It must complete
   without creating a rollout row or changing public promotions, attendance,
   thresholds, or student data.
6. Run the read-only
   `promotion-notifications-phase2-deployment-verification.sql`. Expected:
   all nine Phase 2 routines exist; private helpers have no browser or
   `service_role` execute grant; the worker has only `service_role` execute;
   inbox functions have only `authenticated` execute; Gym 4 remains disabled.
7. Review and deploy the promotion-RPC integration patch only after step 6.
   Re-run the verification query and manually compare the returned RPC body.
8. Deploy the `promotion-notification-worker` Edge Function. Configure its
   caller with a Supabase secret key held only by the trusted operator or
   scheduler—never in the Expo app, repository, or browser.
9. No scheduler is configured by this package. Before automatic delivery, a
   separately approved trusted scheduler must be given the Edge Function URL
   and secret-key credential and send only bounded `POST` requests. Do not add
   `pg_cron`, `pg_net`, or another service without separate approval.
10. Keep the rollout disabled and run only read-only verification. Controlled
   delivery testing and any rollout activation require separate authorization.

## Functional rollback

- Stop the external scheduler and disable the Edge Function before changing
  database behavior.
- If a rollout-control procedure is later deployed and activation has occurred,
  use that trusted administrative procedure to disable Gym 4 first. Preserve
  outbox, event, recipient, and inbox records for audit; do not delete them.
- Restore the archived, freshly verified pre-integration
  `record_student_promotion` definition only after the rollout is disabled and
  unresolved outbox rows have been reconciled.
- Do not perform a destructive schema rollback without a separately approved
  retention/export plan.

## Activation blocker

Phase 1 intentionally provides no trusted rollout-control function. This
package now prepares one, but it is not deployed. A direct private-table update
is not an approved activation mechanism. Activate only through the reviewed
Gym 4-only, audited control function after separate authorization.
