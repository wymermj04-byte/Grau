/**
 * Development-only preparation harness for the Gym 4 notification test.
 * The harness is visible to the reviewed administrator, but every operation
 * that can change server state remains independently disabled.
 */
export const promotionNotificationControlledTestCapability = {
  enabled: true,
  gymId: 4,
  studentId: 64,
  familyUserId: 'd02baad7-7778-4411-9b67-e6008727d4be',
  promotionExecutionEnabled: true,
  reason: 'Promotion notification controlled testing is available only in this development session.',
  actionReason: 'Promotion execution is not authorized yet. No promotion RPC was called.',
} as const;

export function isPromotionNotificationControlledTestEnabled() {
  return process.env.NODE_ENV === 'development'
    && promotionNotificationControlledTestCapability.enabled;
}
