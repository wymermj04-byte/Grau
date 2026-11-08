-- REVIEW ONLY — NOT DEPLOYABLE YET.
--
-- This is intentionally a fail-closed Phase 2 integration gate, not an
-- executable replacement for record_student_promotion. The exact deployed
-- function body is not present in this repository. Replacing it from a guessed
-- body could alter existing authorization, row locks, rank/stripe validation,
-- promotion history, or student updates.
--
-- Required future insertion point, inside the reviewed deployed RPC after the
-- official Promotion row is created and promotion_effective_at is assigned:
--
--   perform grau_promotion_notifications_private.enqueue_verified_promotion_celebration(
--     v_promotion.id, v_promotion.gym_id, v_promotion.student_id,
--     v_promotion.promotion_effective_at
--   );
--
-- The helper must no-op for every gym other than 4, missing/disabled rollout,
-- null floor, or promotion_effective_at <= generation_floor_at. When enabled,
-- it inserts the existing promotion_notification_outbox identity with
-- ON CONFLICT (promotion_id, notification_kind) DO NOTHING. Any unexpected
-- helper/outbox error aborts the promotion transaction; delivery errors occur
-- later in the worker and do not affect the committed promotion.

begin;

do $$
begin
  raise exception
    'STOP: Phase 2 requires the archived deployed record_student_promotion body and a reviewed trusted scheduler contract before SQL can be generated safely.';
end
$$;

rollback;
