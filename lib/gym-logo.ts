export function normalizeGymLogoUrl(value: string | null | undefined) {
  const candidate = value?.trim();
  if (!candidate) return null;

  try {
    const url = new URL(candidate);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

export function shouldRenderGymLogo(source: string | null | undefined, hasLoadError: boolean) {
  return Boolean(normalizeGymLogoUrl(source) && !hasLoadError);
}
