const FALLBACK_APP_URL = (import.meta.env?.VITE_APP_URL as string | undefined)?.trim() ?? '';

export function normalizeOrigin(candidate: string | null | undefined): string {
  const trimmed = (candidate ?? '').trim();
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return '';
    return parsed.origin;
  } catch {
    return '';
  }
}

export function getAuthOrigin(
  browserOrigin: string | undefined = typeof window !== 'undefined' ? window.location.origin : undefined,
  envFallback: string | undefined = FALLBACK_APP_URL,
): string {
  return normalizeOrigin(browserOrigin) || normalizeOrigin(envFallback);
}

export function buildAuthRedirectUrl(
  path = '/',
  browserOrigin: string | undefined = typeof window !== 'undefined' ? window.location.origin : undefined,
  envFallback: string | undefined = FALLBACK_APP_URL,
): string {
  const origin = getAuthOrigin(browserOrigin, envFallback);
  if (!origin) return path.startsWith('/') ? path : '/';
  const safePath = path && path.startsWith('/') && !path.startsWith('//') ? path : '/';
  try {
    return new URL(safePath, origin).toString();
  } catch {
    return `${origin}/`;
  }
}
