/**
 * This is deliberately independent of Family Messaging. It authorizes a
 * development-only diagnostic route, never normal messaging navigation.
 */
export const messagingReadOnlyTestCapability = {
  enabled: true,
  reason: 'Read-only messaging diagnostics are available only in this development session.',
} as const;

export function isMessagingReadOnlyTestEnabled() {
  return process.env.NODE_ENV === 'development' && messagingReadOnlyTestCapability.enabled;
}
