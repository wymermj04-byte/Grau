/**
 * This diagnostic is separate from the operational self-check-in capability.
 * It is deliberately off by default and is never available outside development.
 */
export const familySelfCheckInAuthorizationTestCapability = {
  enabled: false,
  reason: 'Family self-check-in authorization diagnostics are disabled.',
} as const;

export function isFamilySelfCheckInAuthorizationTestEnabled() {
  return process.env.NODE_ENV === 'development'
    && familySelfCheckInAuthorizationTestCapability.enabled;
}
