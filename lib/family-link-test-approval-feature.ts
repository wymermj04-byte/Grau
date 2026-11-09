/**
 * A one-purpose development utility for the reviewed Gym 4 notification-test
 * family link. It is intentionally disabled until a separate operator approval
 * authorizes the RPC call, and it is never available in production builds.
 */
export const familyLinkTestApprovalCapability = {
  enabled: true,
  gymId: 4,
  studentId: 64,
  familyUserId: 'd02baad7-7778-4411-9b67-e6008727d4be',
  relationship: 'parent_guardian',
  reason: 'The Gym 4 notification-test family-link approval utility is not authorized yet.',
} as const;

export function isFamilyLinkTestApprovalUtilityEnabled() {
  return process.env.NODE_ENV === 'development'
    && familyLinkTestApprovalCapability.enabled;
}
