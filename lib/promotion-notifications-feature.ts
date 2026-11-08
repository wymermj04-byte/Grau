/**
 * Promotion notifications remain fail-closed until the reviewed Main rollout
 * has been explicitly activated and controlled testing is complete. Keeping
 * this local gate false means no notification RPC is issued by the app.
 */
export const promotionNotificationsCapability = {
  enabled: false,
  gymId: 4,
  reason: 'Promotion notifications are not enabled for this academy yet.',
} as const;

export function isPromotionNotificationsEnabled() {
  return promotionNotificationsCapability.enabled;
}
