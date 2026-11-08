-- REVIEW ONLY — Phase 2 functional rollback procedure.
--
-- This file intentionally contains no destructive schema rollback. Before any
-- future Phase 2 deployment, the approved rollout-control function must first
-- disable Gym 4 and workers must stop claiming new work. Pending, retryable,
-- and expired leased outbox rows are preserved for audit and reconciliation.
--
-- Do not run a DROP/restore migration while a promotion_notification_outbox row
-- is unresolved. A destructive rollback requires a separately approved data
-- retention/export decision and the archived exact pre-Phase-2
-- record_student_promotion definition.

begin;

do $$
begin
  raise exception
    'STOP: functional rollback must use the future reviewed Gym 4 rollout-control function; destructive rollback is intentionally not included.';
end
$$;

rollback;
