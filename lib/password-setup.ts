/**
 * A password form is only available after this app has exchanged a valid
 * invitation or recovery callback for the same authenticated user. Keeping
 * this comparison pure makes it impossible for an ordinary restored session
 * to unlock password setup.
 */
export function canSetPasswordFromAuthCallback(pendingUserId: string | null, sessionUserId: string | null) {
  return Boolean(pendingUserId && sessionUserId && pendingUserId === sessionUserId);
}

export function destinationAfterIncompleteAuthCallback(sessionUserId: string | null) {
  return sessionUserId ? '/(tabs)' : '/sign-in';
}
