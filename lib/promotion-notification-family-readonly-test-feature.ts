/**
 * This capability is intentionally separate from normal Promotion
 * Notifications. It authorizes one development-only, family-scoped read-only
 * RPC diagnostic while the normal notification capability remains disabled.
 */
export const promotionNotificationFamilyReadOnlyTestCapability = {
  enabled: true,
  gymId: 4,
  reason: 'The family notification diagnostic is available only in this development session.',
} as const;

export function isPromotionNotificationFamilyReadOnlyTestEnabled() {
  return process.env.NODE_ENV === 'development'
    && promotionNotificationFamilyReadOnlyTestCapability.enabled;
}
