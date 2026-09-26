/**
 * Sessions.
 *
 * On sign-in the server creates a random session token, stores only its
 * SHA-256 hash in `public.sessions`, and gives the browser the token in an
 * httpOnly cookie (unreadable by JavaScript, so XSS can't steal it). Every
 * authenticated request looks the hash up; signing out revokes the row.
 */
import config from '../../config/index.js';
import { randomToken, sha256 } from '../../lib/crypto.js';
import * as sessions from './sessions.repository.js';

const prefix = config.session.cookiePrefix;

export const COOKIES = Object.freeze({
  session: `${prefix}_sid`, // session token
  registration: `${prefix}_reg`, // secret that lets this browser poll its registration
});

/** How a session was started — shown on the dashboard. */
export const SessionMethod = Object.freeze({
  EMAIL_VERIFICATION: 'EMAIL_VERIFICATION',
  ONE_TIME_CODE: 'ONE_TIME_CODE',
});

const SESSION_TTL_MS = config.session.ttlDays * 24 * 60 * 60 * 1000;

const baseCookie = {
  httpOnly: true,
  secure: config.isProduction, // HTTPS-only in production; plain http works on localhost
  sameSite: 'lax',
  path: '/',
};

/**
 * Start a session for a user and set the cookie.
 * @returns {Promise<{ method: string, startedAt: string }>} public session info
 */
export async function startSession(res, userId, method) {
  const token = randomToken();
  const row = await sessions.create({
    userId,
    tokenHash: sha256(token),
    method,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  });
  res.cookie(COOKIES.session, token, { ...baseCookie, maxAge: SESSION_TTL_MS });
  return { method: row.method, startedAt: row.created_at };
}

/**
 * Find the caller's active session from their cookie.
 * @returns {Promise<object|null>} the sessions row, or null
 */
export async function resolveSession(req) {
  const token = req.cookies[COOKIES.session];
  if (!token) return null;
  const row = await sessions.findByTokenHash(sha256(token));
  if (!row || row.revoked_at || new Date(row.expires_at) <= new Date()) return null;
  return row;
}

/** Revoke the caller's session (if any) and clear the cookie. */
export async function endSession(req, res) {
  const row = await resolveSession(req);
  if (row) await sessions.revoke(row.id);
  clearSessionCookie(res);
}

export function clearSessionCookie(res) {
  res.clearCookie(COOKIES.session, baseCookie);
}

/** Cookie that ties a pending registration to the browser that created it. */
export function setRegistrationCookie(res, pollSecret) {
  res.cookie(COOKIES.registration, pollSecret, {
    ...baseCookie,
    path: `${config.api.basePath}/registrations`,
    maxAge: config.registration.linkTtlHours * 60 * 60 * 1000,
  });
}

export function clearRegistrationCookie(res) {
  res.clearCookie(COOKIES.registration, { ...baseCookie, path: `${config.api.basePath}/registrations` });
}
