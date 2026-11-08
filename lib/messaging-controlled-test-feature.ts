/**
 * Separate from the normal Messaging feature and the read-only diagnostics.
 * This must stay off until a human explicitly approves a controlled write test.
 */
export const messagingControlledTestCapability = {
  enabled: true,
  reason: 'Controlled messaging tests are available only in this development session.',
} as const;

export function isMessagingControlledTestEnabled() {
  return process.env.NODE_ENV === 'development' && messagingControlledTestCapability.enabled;
}

/**
 * A separate development-only gate for recovery after an acknowledgement
 * rejection. It is enabled only for the explicitly approved Gym 4 recovery
 * availability check. Enabling the controlled test runner never enables this
 * capability by itself, and recovery still requires an explicit confirmation
 * before it can request a fresh server-issued unread cursor.
 */
export const messagingControlledAcknowledgementRecoveryCapability = {
  enabled: true,
  reason: 'Acknowledgement recovery is available only for the approved development-only Gym 4 recovery check.',
} as const;

export function isMessagingControlledAcknowledgementRecoveryEnabled() {
  return process.env.NODE_ENV === 'development' && messagingControlledAcknowledgementRecoveryCapability.enabled;
}

/**
 * Separate development-only completion gate for the one reviewed
 * post-acknowledgement mismatch. It is enabled only for the explicitly
 * approved Gym 4 completion-interface check. It exposes a confirmed,
 * read-only family-inbox verification; it never issues a cursor or changes a
 * read marker.
 */
export const messagingControlledCompletionCapability = {
  enabled: true,
  reason: 'Post-acknowledgement completion is available only for the approved development-only Gym 4 completion check.',
} as const;

export function isMessagingControlledCompletionEnabled() {
  return process.env.NODE_ENV === 'development' && messagingControlledCompletionCapability.enabled;
}
