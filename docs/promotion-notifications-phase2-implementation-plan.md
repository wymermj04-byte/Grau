# Promotion Alerts Phase 2 — review-only implementation package

Status: **not deployable until the live-contract gates below pass.** Notifications remain disabled.

## Scope

Phase 2 uses the existing `grau_promotion_notifications_private` Phase 1
tables. It adds no trigger to `public."Promotions"` and does not scan that
table for historical rows.

## Official promotion celebrations

The reviewed implementation changes the deployed
`public.record_student_promotion(bigint,text,integer,text)` body only by
adding this final step after its existing authorization, locking, validation,
promotion insert, and student update have succeeded:

1. Read and lock the Gym 4 notification rollout row.
2. If no row is enabled, or `generation_floor_at` is null, return normally;
   this is the expected disabled state and creates no notification work.
3. If the new database-assigned
   `promotion_effective_at > generation_floor_at`, insert one private
   `promotion_notification_outbox` row with `notification_kind =
   'promotion_celebration'`.
4. Use the existing `(promotion_id, notification_kind)` unique key with
   `ON CONFLICT DO NOTHING`.

The outbox insertion is in the same transaction as the official promotion.
An unexpected private-table error therefore aborts that promotion transaction;
it cannot be represented as an independent notification failure. The rollout
must remain disabled until this integration has been compiled and tested.

Delivery happens later. A delivery, recipient-resolution, or worker failure
does not affect a committed promotion: the worker uses the existing leased
outbox row to retry.

The legacy direct-insert fallback intentionally does not call the RPC and
therefore cannot create an outbox row or a family celebration.

## Worker contract

Only a trusted database worker may claim outbox rows. It must:

- Lock/lease one due `pending` or `retry_scheduled` row at a time.
- Recheck that Gym 4 is enabled before materializing recipients.
- Snapshot only approved, non-revoked links matching the outbox gym/student.
- Insert recipients, one `promotion_celebration` event, and one family inbox
  row per snapshot recipient in one transaction.
- Mark the outbox `delivered` only after all materialization inserts succeed.
- Record retry state after a failure without modifying the promotion row.

When the rollout is disabled, workers claim no new work. Existing pending,
retryable, and expired leased rows are preserved, never deleted or silently
delivered. A later authorized re-enable may resume preserved work; an operator
must explicitly decide whether to retain or retire that work before re-enable.

The prepared Edge Function source is documented in
`docs/promotion-notifications-phase2-edge-worker.md`. It uses Supabase secret
authentication and calls a service-role-only worker RPC; it does not put a
service-role credential in the mobile app. Because neither `pg_cron` nor
`pg_net` is installed, an external trusted scheduler remains required for
automatic work.

## Staff milestones

The worker must process only a newly committed, qualifying scheduled-attendance
record after the rollout floor. It must compare before/after progress for the
same student and cycle, creating `five_remaining` only for a real `6 -> 5`
crossing and `eligible_for_review` only for a first unmet-to-met crossing.

Historical boundaries, baselines, class edits, and ordinary rereads must never
be milestone sources. The existing unique `(advancement_cycle_id,
milestone_kind)` key is the final idempotency guard.

This part is blocked until a live-reviewed, server-side per-student progress
evaluator is available. The TypeScript calculator is not callable from SQL,
and duplicating its threshold/boundary logic would create an unsafe second
promotion rule system.

## Family read contract

Future authenticated family RPCs must recheck `auth.uid()` against a current
approved, non-revoked `member_account_links` row for every inbox read and
mark-read request. `mark read` updates only an unread authorized row; an
already-read authorized row is success with its original timestamp unchanged.

## Required deployment gates

1. Inventory and archive the exact deployed `record_student_promotion`
   definition, owner, grants, `SECURITY DEFINER`, and `search_path`.
2. Verify it database-assigns non-null `promotion_effective_at`.
3. Verify the private Phase 1 tables/triggers/ACLs still match the reviewed
   contract and Gym 4 has no enabled rollout.
4. Verify a trusted scheduler identity. `pg_cron` availability is not assumed.
   A browser or ordinary authenticated/service-role client must not gain direct
   access to the private schema.
5. Review a function-body replacement that is byte-for-byte the archived RPC
   definition plus the narrowly placed outbox enqueue call.
6. Deploy with rollout disabled; run read-only verification; then separately
   authorize activation and authenticated tests.

## Deployment order

1. Execute the read-only inventory and archive its results.
2. Resolve the exact RPC-body and progress-evaluator blockers.
3. Review a transactional migration that adds private enqueue/worker helpers,
   public family/staff inbox RPCs, and the single reviewed RPC-body change.
4. Deploy the SQL with no Gym 4 rollout row and verify all grants/RLS/objects.
5. Deploy the prepared Edge Function with secret authentication.
6. Configure an external trusted scheduler secret outside the app.
7. Run controlled authenticated tests while rollout remains disabled, then
   separately authorize an audited Gym 4 activation.

## Rollback

Functional rollback is first: disable Gym 4, stop worker claims, and retain
private outbox/event/audit rows. Do not drop Phase 1 tables or revert the RPC
while unresolved outbox rows exist. A destructive schema rollback requires a
separate reviewed retention/export decision.
