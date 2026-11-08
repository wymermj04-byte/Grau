# Family Self-Check-In validation plan

## Deployment status

This feature is intentionally disabled. The review migration creates no enabled rollout row, and the application capability in `lib/self-check-in-feature.ts` remains `false`. Do not deploy this plan or enable the capability until every database test below passes in an isolated Supabase-compatible PostgreSQL environment.

## RPC contracts

All public functions are `SECURITY DEFINER`, set a fixed search path, revoke `PUBLIC` and `anon` execution, and grant only `authenticated` execution. Their private tables have RLS enabled, no API-role table grants, and are reachable only from the reviewed functions.

| RPC | Caller | Contract |
| --- | --- | --- |
| `family_self_check_in_available_classes(bigint)` | approved family | Lists only the caller's gym's valid Scheduled or active In Progress classes after the opening boundary. |
| `family_self_check_in_eligible_students(bigint,bigint)` | approved family | Lists only the caller's approved linked students and each student’s current eligibility. |
| `family_self_check_in_request(bigint,bigint,bigint[],uuid)` | approved family | Creates no attendance. Before a new batch exists, every selected member must have an approved, non-revoked link locked in sorted student-ID order; an unauthorized selection creates no private batch, request, or outcome. The UUID identifies one exact family/gym/class/sorted-student payload; matching retries return durable outcomes only after every originally selected member is still covered by the caller's approved, non-revoked link. Mismatches or revoked access fail closed. One request may exist for a student/class across all family accounts. |
| `staff_self_check_in_list_requests(bigint)` | active admin/coach | Lists requests for one staff-authorized class only. |
| `staff_self_check_in_resolve_request(bigint,text,uuid)` | active admin/coach | Approves or declines one request. Approval is the only path that inserts attendance. A matching resolution key and decision is retry-safe; every conflicting retry fails. Declines may resolve a pending request after the class closes, but approvals cannot. |
| `staff_self_check_in_bulk_approve(bigint,bigint[],uuid)` | active admin/coach | Strictly approves one normalized, distinct request-ID set from one staff-authorized class. The UUID is bound to the exact gym, class, authenticated staff caller, and sorted selection. Exact retries are safe; changed selections or callers fail. Every result must be `approved`; any duplicate, ownership failure, business failure, or unexpected error rolls back the whole RPC transaction. |

## Locking and lifecycle test matrix

The shared lock order is: enabled rollout row, class row, then request/link/student rows in ascending student or request ID. The final lifecycle decision uses `clock_timestamp()` after the class row lock. Existing direct updates to `public.classes` acquire the same PostgreSQL row lock.

1. At exactly fifteen minutes before a valid Scheduled class, a family request succeeds; one microsecond before, it fails. Test both a standard date and each America/New_York DST transition.
2. A Scheduled class with `is_active = true`, an In Progress class with `is_active = false`, any NULL/unknown status, or a missing/invalid date, time, audience, or time zone fails closed.
3. While an approval holds the class row lock, a direct Complete or Cancel update waits. If that update commits first, approval re-reads the resulting lifecycle and fails without inserting attendance. If approval holds the lock first, the lifecycle update waits until its transaction completes.
4. Concurrent individual staff approval and direct staff attendance insertion for the same class/student produce exactly one row under `attendance_unique_class_student`; the losing approval confirms the matching row before returning `already_checked_in`. In strict bulk approval, that outcome must roll back every approval in the bulk transaction.
5. Reusing a family request UUID with identical family/gym/class/sorted-student payload returns the saved outcomes only while every original family link remains approved and non-revoked. Revoke one original member link before retrying: the retry must fail closed without returning any request status. A changed payload or a UUID owned by a different family is rejected without exposing request data. Repeating staff approval/decline with the same resolution key and decision returns the terminal state; any conflicting key or decision is rejected. Submit a new batch containing one student without an approved link: it must fail before inserting any `request_batches`, `requests`, `batch_conflict_outcomes`, or audit rows.
6. Revoke an approved family link between request and approval. The approval must lock and revalidate the link, record `ineligible`, and create no attendance.
7. Test multi-student requests in opposite input orders concurrently. The server’s sorted student order must complete without deadlock and return one outcome for each selected student. Test two approved family accounts for the same student/class: only one durable request may be created, and the other caller receives no request details.
8. Test rollout deactivation racing with a family request and with staff approval. The rollout row lock ensures deactivation either commits before the request/approval (which then rejects), or waits until the in-flight transaction completes.
9. Test a Scheduled class at its exact 12-hour stale cutoff and immediately before it; only the latter is requestable. Verify the cutoff never applies to a valid In Progress class.
10. Submit a bulk approval, then retry the exact gym/class/staff/sorted request-ID selection with the same UUID; it must return the durable approved outcomes without new attendance or audit events, including after the class is Completed or Cancelled. A new UUID after completion or cancellation must fail before any attendance write. Reuse the original UUID with a changed selection, another class or gym, or a different authorized staff caller; every mismatch must fail without resolving or exposing additional requests.
11. Submit a bulk selection where one request becomes ineligible or already checked in before approval. Confirm the RPC fails and its transaction leaves every selected request pending with no new attendance; the staff screen must describe this all-or-nothing result before submission and after a server rejection.

## Authorization and regression tests

1. `anon`, `PUBLIC`, and authenticated direct-table calls cannot use the private schema or tables. Only the six listed public RPCs are executable by `authenticated`.
2. An unlinked or revoked family account cannot list classes, list students, or submit requests. A family from another gym cannot access Gym 4 objects.
3. A staff member outside the class gym, inactive staff, and non-admin/non-coach member cannot list, approve, decline, or bulk approve requests.
4. Active and Trial students with matching `kids`, `adults`, or `mixed` program audience may be requested; Paused, Inactive, NULL, unknown-status, mismatched-program, and cross-gym students are not approvable.
5. Verify a successful approval invokes the existing attendance snapshot trigger and preserves the class’s current classification. Verify no request, decline, duplicate, or ineligible outcome inserts attendance.
6. Re-run existing manual staff check-in, class Start, Complete, Cancel, Stripe Progress, Payment Tracking, and Messaging regression suites. None of their objects or RPCs are modified by this migration.

## Local application checks

The app screens use the existing resolved staff/family access model. The family route requires a resolved family account and an approved linked gym, while the staff queue independently verifies active admin/coach access. Neither route appears in navigation or calls an RPC until the local capability is deliberately enabled after server validation.

## Current limitation

No disposable Supabase-compatible PostgreSQL environment is available in this workspace. The SQL has not been compiled or concurrency-tested against PostgreSQL; the migration and this plan remain review-only.
