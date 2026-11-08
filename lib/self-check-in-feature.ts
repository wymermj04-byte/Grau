/**
 * The client release switch only exposes the Gym 4 experience. Main
 * Supabase's per-gym rollout remains the authoritative server-side gate.
 * This is deliberately disabled unless a release explicitly sets the public
 * environment value to the exact string "true".
 */
export const FAMILY_SELF_CHECK_IN_GYM_ID = 4;

export const selfCheckInCapability = {
  enabled: process.env.EXPO_PUBLIC_FAMILY_SELF_CHECK_IN_GYM4_ENABLED === 'true',
  gymId: FAMILY_SELF_CHECK_IN_GYM_ID,
  reason: 'Family self-check-in is not enabled for this academy yet.',
} as const;

/**
 * This cannot activate Main Supabase. It only permits the client to surface
 * the Gym 4 gateway after an explicit release configuration change.
 */
export function isSelfCheckInEnabled() {
  return selfCheckInCapability.enabled;
}

export function isSelfCheckInEnabledForGym(gymId: number | null | undefined) {
  return selfCheckInCapability.enabled && gymId === selfCheckInCapability.gymId;
}

export const selfCheckInPreviewCapability = {
  enabled: true,
  reason: 'Development preview only. No family check-in is available.',
} as const;

export function isSelfCheckInPreviewEnabled() {
  return process.env.NODE_ENV === 'development'
    && selfCheckInPreviewCapability.enabled;
}
