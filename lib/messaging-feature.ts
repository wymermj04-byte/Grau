/**
 * Messaging remains fail-closed until its reviewed Supabase migration and RPC
 * contract are deployed. Keep this as a local capability switch rather than
 * probing or calling undeployed RPCs from the preview.
 */
export const messagingCapability = {
  enabled: false,
  reason: 'Family messaging is not enabled for this academy yet.',
} as const;

export function isMessagingEnabled() {
  return messagingCapability.enabled;
}
