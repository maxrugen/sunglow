/** Coordinates from untrusted input; null unless both are finite and in range. */
export function parseLatLon(lat: unknown, lon: unknown): { latitude: number; longitude: number } | null {
  if (lat === null || lat === undefined || lat === '' || lon === null || lon === undefined || lon === '') return null;
  const latitude = Number(lat);
  const longitude = Number(lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { latitude, longitude };
}

/** Longest location label stored with a push subscription (it ends up in notification text). */
export const MAX_LABEL_LENGTH = 80;

/** Trimmed, length-capped label, or null if empty or not a string. */
export function cleanLabel(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const label = value.trim().slice(0, MAX_LABEL_LENGTH);
  return label || null;
}

function base64UrlByteLength(value: string): number | null {
  if (!/^[A-Za-z0-9_-]+={0,2}$/.test(value)) return null;
  return Buffer.from(value, 'base64url').length;
}

/**
 * Web Push keys as the Push API produces them: p256dh is an uncompressed P-256
 * public key (65 bytes) and auth a 16-byte secret, both base64url-encoded.
 * Rejecting anything else up front stops subscriptions that could never be sent to.
 */
export function validPushKeys(p256dh: unknown, auth: unknown): boolean {
  return (
    typeof p256dh === 'string' &&
    typeof auth === 'string' &&
    base64UrlByteLength(p256dh) === 65 &&
    base64UrlByteLength(auth) === 16
  );
}
