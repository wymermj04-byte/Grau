// @ts-nocheck
// This file runs in Supabase's Deno Edge runtime, not the Expo TypeScript runtime.
import { withSupabase } from "npm:@supabase/server@1";

/**
 * Trusted server-only dispatcher for the Gym 4 promotion-notification outbox.
 *
 * Supabase verifies the caller's secret key before this handler runs and makes
 * the service-role client available as ctx.supabaseAdmin. No credential is
 * embedded here or exposed to the Expo app.
 */
export default {
  fetch: withSupabase({ auth: "secret" }, async (request, ctx) => {
    if (request.method !== "POST") {
      return Response.json({ ok: false }, { status: 405 });
    }

    const { data, error } = await ctx.supabaseAdmin.rpc(
      "process_gym4_promotion_notification_outbox",
      { p_limit: 25 },
    );

    if (error) {
      // Only the exact, verified RPC disabled-rollout signal is a safe no-op.
      // Other 42501 errors can be real permission regressions and must fail.
      // Do not expose the database signal to the caller.
      if (
        error.code === "42501" &&
        error.message === "Promotion notifications are not enabled for this gym."
      ) {
        return Response.json({ ok: true, disabled: true });
      }
      // Deliberately log no recipient, student, or promotion data.
      // eslint-disable-next-line no-console
      console.error("promotion notification worker failed", {
        code: error.code,
        message: error.message,
      });
      return Response.json({ ok: false }, { status: 500 });
    }

    // The RPC returns only aggregate counters.
    return Response.json({ ok: true, result: data });
  }),
};
