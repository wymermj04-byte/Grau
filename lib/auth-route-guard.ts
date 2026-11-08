export const INVITE_ACCEPT_PATH = '/auth/accept-invite';

export function bypassesGymAccessGuard(pathname: string) {
  return pathname === INVITE_ACCEPT_PATH;
}
