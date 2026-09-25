/**
 * Session handling.
 *
 * Supabase issues the session (a short-lived JWT access token + a refresh
 * token). We never hand those to browser JavaScript: they live in httpOnly
 * cookies, which XSS can't read. Every authenticated request is checked
 * against Supabase, and an expired access token is refreshed transparently.
 */
import config from '../../config/index.js';
import { createAuthClient } from '../../lib/supabase.js';
import { Errors } from '../../lib/errors.js';

const prefix = config.session.cookiePrefix;

export const COOKIES = Object.freeze({
  access: `${prefix}_at`, // Supabase access token (JWT)
  refresh: `${prefix}_rt`, // Supabase refresh token
  method: `${prefix}_am`, // how the session started (signed, informational)
  registration: `${prefix}_reg`, // secret that lets this browser poll its registration
});

/** How a session was started — shown on the dashboard. */
export const SessionMethod = Object.freeze({
  EMAIL_VERIFICATION: 'EMAIL_VERIFICATION',
  ONE_TIME_CODE: 'ONE_TIME_CODE',
});

const REFRESH_MAX_AGE_MS = config.session.refreshTtlDays * 24 * 60 * 60 * 1000;

const baseCookie = {
  httpOnly: true,
  secure: config.isProduction, // HTTPS-only in production; plain http works on localhost
  sameSite: 'lax',
  path: '/',
};

/** Store a Supabase session in cookies. */
export function setSessionCookies(res, session, method) {
  res.cookie(COOKIES.access, session.access_token, { ...baseCookie, maxAge: session.expires_in * 1000 });
  res.cookie(COOKIES.refresh, session.refresh_token, { ...baseCookie, maxAge: REFRESH_MAX_AGE_MS });
  if (method) res.cookie(COOKIES.method, method, { ...baseCookie, maxAge: REFRESH_MAX_AGE_MS, signed: true });
}

export function clearSessionCookies(res) {
  [COOKIES.access, COOKIES.refresh, COOKIES.method].forEach((name) => res.clearCookie(name, baseCookie));
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

/** 4xx from Supabase = "this token is bad"; anything else = Supabase is unhealthy. */
const isClientError = (error) => error.status >= 400 && error.status < 500;

/**
 * Work out who is calling from their cookies.
 * Returns { user, accessToken } for a valid session, or null.
 * Refreshes and re-sets cookies when only the refresh token is still valid.
 */
export async function resolveSession(req, res) {
  const accessToken = req.cookies[COOKIES.access];
  if (accessToken) {
    const { data, error } = await createAuthClient().getUser(accessToken);
    if (!error && data.user) return { user: data.user, accessToken };
    if (error && !isClientError(error)) throw Errors.upstream();
  }

  const refreshToken = req.cookies[COOKIES.refresh];
  if (!refreshToken) return null;

  const { data, error } = await createAuthClient().refreshSession({ refresh_token: refreshToken });
  if (error && !isClientError(error)) throw Errors.upstream();
  if (error || !data.session) {
    clearSessionCookies(res);
    return null;
  }
  setSessionCookies(res, data.session);
  return { user: data.session.user, accessToken: data.session.access_token };
}
