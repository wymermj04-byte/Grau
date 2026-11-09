/**
 * The production client exposes promotion notifications only to the protected
 * approved-family routes. The server remains authoritative for the Gym 4
 * rollout plus approved-family authorization.
 */
export const promotionNotificationsCapability = {
  enabled: true,
  gymId: 4,
  reason: 'Promotion notifications are available to approved Gym 4 families when the academy rollout is enabled.',
} as const;

export function isPromotionNotificationsEnabled() {
  return promotionNotificationsCapability.enabled;
}
