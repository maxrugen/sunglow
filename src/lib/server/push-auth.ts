import { env } from '$env/dynamic/private';

/**
 * Optional deterrent gate for the subscribe/unsubscribe routes. If SUBSCRIBE_TOKEN
 * is unset (e.g. local dev) the routes are open. Because the browser copy is
 * PUBLIC_SUBSCRIBE_TOKEN, this is a light deterrent, not real authentication.
 */
export function pushRequestAuthorized(request: Request): boolean {
  const token = env.SUBSCRIBE_TOKEN;
  if (!token) return true;
  return request.headers.get('authorization') === `Bearer ${token}`;
}
