export type AuthLinkPayload =
  | { kind: 'code'; code: string }
  | { kind: 'session'; accessToken: string; refreshToken: string }
  | { kind: 'error'; message: string }
  | { kind: 'invalid' };

function getParameter(url: URL, name: string) {
  return url.searchParams.get(name) ?? new URLSearchParams(url.hash.slice(1)).get(name);
}

/**
 * Reads a Supabase invitation or recovery redirect without logging the URL.
 * Supabase may send PKCE `code` query params or implicit-flow tokens in the
 * fragment, depending on the project's Auth configuration.
 */
export function parseAuthLink(rawUrl: string): AuthLinkPayload {
  try {
    const url = new URL(rawUrl);
    const errorDescription = getParameter(url, 'error_description');
    const error = getParameter(url, 'error');
    if (errorDescription || error) {
      return { kind: 'error', message: errorDescription ?? error ?? 'This link is no longer valid.' };
    }

    const code = getParameter(url, 'code');
    if (code) return { kind: 'code', code };

    const accessToken = getParameter(url, 'access_token');
    const refreshToken = getParameter(url, 'refresh_token');
    if (accessToken && refreshToken) {
      return { kind: 'session', accessToken, refreshToken };
    }
  } catch {
    // Fall through to the intentionally non-specific invalid-link state.
  }

  return { kind: 'invalid' };
}
