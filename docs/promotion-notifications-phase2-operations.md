# Promotion Notifications Phase 2 — deployment and rollback operations

Gym 4 notifications remain disabled until a separate activation approval.

## Deployment order

1. Run the existing read-only deployment verification in Main Supabase and
   save the output.
2. Review and deploy the Gym 4-only rollout-controller migration. It creates
   no rollout row and grants no browser or service-role access.
3. Re-run the read-only verification. Confirm the integration, function
   permissions, disabled rollout state, and zero notification counts.
4. Deploy the `promotion-notification-worker` Edge Function with
   `supabase/config.toml` applied. Supabase's `@supabase/server` wrapper
   validates a secret API key and supplies the privileged server client; no
   service-role key belongs in the Expo app or repository.
5. Give a separately approved external scheduler the function URL and the
   server-held Supabase secret API key. Use a bounded POST interval. Neither
   `pg_cron`, `pg_net`, nor `pgmq` is available or required by this package.
6. Keep Gym 4 disabled and confirm the worker returns the disabled no-op
   response before scheduling any recurring work.
7. Obtain separate approval for the controlled activation checklist.

## Logical rollback

1. Stop external scheduler calls first.
2. Use the private, trusted-postgres rollout controller to disable Gym 4 with
   a new request UUID and an accountable reason.
3. Verify the resulting disabled state, immutable control audit event, and
   preserved aggregate outbox/event/inbox records.
4. Undeploy or disable the Edge Function only after scheduler calls have
   stopped.
5. Leave the mobile capability disabled. If it had been enabled for a later
   release, ship a build with that local gate false before removing access.
6. Do not drop private tables, audit records, or functions. Restoring the
   original promotion RPC or destructively removing Phase 2 requires a
   separate approved retention and reconciliation plan.

## Deployment dependencies

- A trusted Main Supabase `postgres` session for the rollout controller.
- Supabase Edge Function deployment access.
- A server-controlled Supabase secret API key for the worker caller.
- An approved scheduler outside the Expo app. This remains the only unresolved
  infrastructure dependency; the project has no installed database scheduler.
