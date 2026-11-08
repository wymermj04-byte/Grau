export class AuthRequestTimeoutError extends Error {
  constructor() {
    super('Authentication request timed out.');
    this.name = 'AuthRequestTimeoutError';
  }
}

/** Keeps user-facing authentication actions retryable when the network stalls. */
export async function withAuthRequestTimeout<T>(request: () => Promise<T>, timeoutMs = 15_000): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      request(),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new AuthRequestTimeoutError()), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}
