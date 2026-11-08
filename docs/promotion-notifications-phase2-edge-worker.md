# Promotion Alerts Phase 2 — trusted Edge worker

This is deployment source preparation only. Do not add it to the mobile app,
and do not deploy it until the SQL worker RPC and its `service_role`-only grant
have been reviewed.

The deployable source is at
`supabase/functions/promotion-notification-worker/index.ts`. Deploy it as an
Edge Function named `promotion-notification-worker` with secret-key
authentication. `supabase/config.toml` sets `verify_jwt = false` because the
function uses Supabase's server SDK to validate the caller's secret API key,
not a browser JWT. It contains no database key in source: Supabase verifies
the caller’s secret key and supplies `ctx.supabaseAdmin`.

```ts
import { withSupabase } from 'npm:@supabase/server@1'

export default {
  fetch: withSupabase({ auth: 'secret' }, async (_request, ctx) => {
    const { data, error } = await ctx.supabaseAdmin.rpc(
      'process_gym4_promotion_notification_outbox',
      { p_limit: 25 },
    )

    if (error?.code === '42501') {
      return Response.json({ ok: true, disabled: true })
    }

    if (error) {
      console.error('promotion notification worker failed', {
        code: error.code,
        message: error.message,
      })
      return Response.json({ ok: false }, { status: 500 })
    }

    return Response.json({ ok: true, result: data })
  }),
}
```

The worker can invoke only a public, SECURITY DEFINER RPC that verifies the
request role is `service_role`, then performs all private-schema work under a
fixed search path. It must receive no direct private-table grants.

When the rollout is disabled, the database fails closed and the worker returns
only `{ ok: true, disabled: true }`. It does not claim rows, disclose private
state, or convert the expected disabled condition into scheduler retries.

## Scheduling dependency

Neither `pg_cron` nor `pg_net` is installed. Edge Functions do not schedule
themselves. The fastest supported option is an external trusted scheduler that
POSTs to this function with the project secret key at a bounded interval. A
Supabase Dashboard/SQL scheduler becomes an alternative only after a separate,
approved installation and configuration of its required extensions.

The external scheduler credential is a deployment dependency. It needs the
deployed Edge Function URL and a Supabase secret API key authorized for that
function; both must be kept outside the mobile app and outside this repository.
It should send only a bounded `POST` request and treat `{ ok: true, disabled:
true }` as a successful no-op. Until it exists, an authorized operator may
invoke the worker manually for controlled testing; no automatic delivery is
available.
