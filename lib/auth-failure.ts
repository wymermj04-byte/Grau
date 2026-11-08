export type AuthFailureStage = 'Invitation session' | 'Session validation' | 'Password save';

export type SafeAuthFailure = {
  stage: AuthFailureStage;
  code?: string;
  status?: number;
  timedOut?: boolean;
};

export function toSafeAuthFailure(stage: AuthFailureStage, error: unknown, timedOut = false): SafeAuthFailure {
  const candidate = error && typeof error === 'object' ? error as { code?: unknown; status?: unknown } : null;
  return {
    stage,
    ...(typeof candidate?.code === 'string' ? { code: candidate.code } : {}),
    ...(typeof candidate?.status === 'number' ? { status: candidate.status } : {}),
    ...(timedOut ? { timedOut: true } : {}),
  };
}

export function formatSafeAuthFailure(failure: SafeAuthFailure) {
  const details = [
    failure.timedOut ? 'Request timed out' : null,
    failure.code ? `Code: ${failure.code}` : null,
    failure.status ? `Status: ${failure.status}` : null,
  ].filter(Boolean);
  return `${failure.stage} failed.${details.length ? ` ${details.join(' · ')}` : ''} You can try again.`;
}
