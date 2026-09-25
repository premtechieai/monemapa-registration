/**
 * In-memory stand-in for Supabase Auth — the subset this app calls:
 *
 *   admin.inviteUserByEmail  create/re-invite unconfirmed user, email a verification link
 *   admin.getUserById        read email_confirmed_at (what the status poll checks)
 *   admin.generateLink       magic-link token for the post-verification session
 *   admin.signOut            revoke a session
 *   client.signInWithOtp     email a sign-in code
 *   client.verifyOtp         check a code (or a magic-link token hash) → session
 *   client.getUser           validate an access token
 *   client.refreshSession    rotate a refresh token
 *
 * Results and errors use supabase-js shapes ({ data, error } with status/code),
 * so the services' error handling is exercised exactly as in production.
 * Emails go to the sandbox inbox (see store.js) instead of a mail server.
 *
 * SANDBOX ONLY.
 */
import crypto from 'node:crypto';
import config from '../config/index.js';
import { randomToken, sha256 } from '../lib/crypto.js';
import { deliverMail, getState, persist, recordEvent } from './store.js';

// Supabase defaults: links live 24h, codes 1h, access tokens 1h.
const LINK_TTL_MS = 24 * 60 * 60 * 1000;
const CODE_TTL_MS = 60 * 60 * 1000;
const ACCESS_TTL_SEC = 60 * 60;

const nowIso = () => new Date().toISOString();
const isPast = (iso) => new Date(iso) <= new Date();

/** Error shaped like supabase-js AuthApiError. */
function authError(status, code, message) {
  return Object.assign(new Error(message), { name: 'AuthApiError', status, code });
}

const users = () => getState().authUsers;
const findByEmail = (email) => users().find((u) => u.email === email);
const findById = (id) => users().find((u) => u.id === id);

/** The user object Supabase returns (internal token fields stripped). */
function publicUser(u) {
  const { confirmation, otp, magicLink, ...rest } = u;
  return { ...structuredClone(rest), aud: 'authenticated', role: 'authenticated' };
}

function issueSession(user) {
  user.last_sign_in_at = nowIso();
  const session = {
    access_token: `sbx_at_${randomToken(24)}`,
    refresh_token: `sbx_rt_${randomToken(24)}`,
    token_type: 'bearer',
    expires_in: ACCESS_TTL_SEC,
    expires_at: Math.floor(Date.now() / 1000) + ACCESS_TTL_SEC,
  };
  getState().sessions.push({ ...session, userId: user.id, revoked: false });
  persist();
  return { ...session, user: publicUser(user) };
}

const ok = (data) => ({ data, error: null });
const fail = (error, data = { user: null, session: null }) => ({ data, error });

// ---------------------------------------------------------------------------
// Admin API (service role)
// ---------------------------------------------------------------------------
export const admin = {
  async inviteUserByEmail(email, { data: metadata = {}, redirectTo } = {}) {
    let user = findByEmail(email);
    if (user?.email_confirmed_at) {
      return fail(authError(422, 'email_exists', 'A user with this email address has already been registered'), { user: null });
    }
    if (!user) {
      user = { id: crypto.randomUUID(), email, created_at: nowIso(), email_confirmed_at: null, last_sign_in_at: null, user_metadata: metadata };
      users().push(user);
    }

    // A new token replaces the previous one, so older links stop working.
    const token = randomToken();
    user.confirmation = { tokenHash: sha256(token), expiresAt: new Date(Date.now() + LINK_TTL_MS).toISOString(), redirectTo };
    persist();

    const link =
      `${config.app.baseUrl}/sandbox/auth/verify?token=${encodeURIComponent(token)}` +
      `&redirect_to=${encodeURIComponent(redirectTo ?? config.app.baseUrl)}`;
    deliverMail({ kind: 'verify', to: email, subject: 'Verify your email address', link, tokenHash: user.confirmation.tokenHash });
    recordEvent('auth.invite', `verification link emailed to ${email}`);
    return ok({ user: publicUser(user) });
  },

  async getUserById(id) {
    const user = findById(id);
    return user ? ok({ user: publicUser(user) }) : fail(authError(404, 'user_not_found', 'User not found'), { user: null });
  },

  async generateLink({ type, email }) {
    const user = findByEmail(email);
    if (type !== 'magiclink' || !user) return fail(authError(404, 'user_not_found', 'User not found'), { properties: null, user: null });
    const hashedToken = randomToken();
    user.magicLink = { tokenHash: hashedToken, expiresAt: new Date(Date.now() + LINK_TTL_MS).toISOString() };
    persist();
    return ok({ properties: { hashed_token: hashedToken }, user: publicUser(user) });
  },

  async signOut(accessToken) {
    const session = getState().sessions.find((s) => s.access_token === accessToken);
    if (session) {
      session.revoked = true;
      persist();
      recordEvent('auth.logout', findById(session.userId)?.email ?? '');
    }
    return ok(null);
  },
};

// ---------------------------------------------------------------------------
// Anon client (user-facing auth calls)
// ---------------------------------------------------------------------------
const client = {
  async signInWithOtp({ email, options = {} }) {
    const user = findByEmail(email);
    if (!user) {
      if (options.shouldCreateUser === false) return fail(authError(422, 'otp_disabled', 'Signups not allowed for otp'));
      return fail(authError(400, 'not_supported', '[sandbox] OTP sign-up is not emulated'));
    }
    const code = Array.from({ length: config.otp.length }, () => crypto.randomInt(10)).join('');
    user.otp = { code, expiresAt: new Date(Date.now() + CODE_TTL_MS).toISOString() };
    persist();
    deliverMail({ kind: 'otp', to: email, subject: 'Your sign-in code', code });
    recordEvent('auth.otp_sent', email);
    return ok({ user: null, session: null });
  },

  async verifyOtp(params) {
    const invalid = () => fail(authError(403, 'otp_expired', 'Token has expired or is invalid'));

    // Magic-link token hash (used right after registration to start a session).
    if (params.token_hash) {
      const user = users().find((u) => u.magicLink?.tokenHash === params.token_hash);
      if (!user || isPast(user.magicLink.expiresAt)) return invalid();
      delete user.magicLink;
      recordEvent('auth.session_started', `${user.email} · via email verification`);
      return ok({ user: publicUser(user), session: issueSession(user) });
    }

    // Emailed code.
    const user = findByEmail(params.email);
    if (!user?.otp || isPast(user.otp.expiresAt) || user.otp.code !== params.token) {
      recordEvent('auth.otp_rejected', params.email ?? '', true);
      return invalid();
    }
    delete user.otp;
    if (!user.email_confirmed_at) user.email_confirmed_at = nowIso();
    recordEvent('auth.session_started', `${user.email} · via one-time code`);
    return ok({ user: publicUser(user), session: issueSession(user) });
  },

  async getUser(accessToken) {
    const session = getState().sessions.find((s) => s.access_token === accessToken);
    if (!session || session.revoked || session.expires_at * 1000 <= Date.now()) {
      return fail(authError(403, 'bad_jwt', 'invalid JWT: token is expired or revoked'), { user: null });
    }
    return ok({ user: publicUser(findById(session.userId)) });
  },

  async refreshSession({ refresh_token: refreshToken }) {
    const session = getState().sessions.find((s) => s.refresh_token === refreshToken && !s.revoked);
    const user = session && findById(session.userId);
    if (!user) return fail(authError(400, 'refresh_token_not_found', 'Invalid Refresh Token: Refresh Token Not Found'));
    session.revoked = true; // refresh tokens are single-use (rotation)
    const next = issueSession(user);
    return ok({ user: next.user, session: next });
  },
};

export const createClientAuth = () => client;

/**
 * What Supabase's /verify endpoint does when the emailed link is clicked:
 * confirm the email if the token is current. Used by sandbox.routes.js.
 * @returns {{ ok: boolean, email?: string, reason?: string }}
 */
export function confirmEmailByToken(token) {
  const tokenHash = sha256(String(token ?? ''));
  const user = users().find((u) => u.confirmation?.tokenHash === tokenHash);
  if (!user) return { ok: false, reason: 'This link is invalid or has been replaced by a newer one.' };
  if (isPast(user.confirmation.expiresAt)) return { ok: false, reason: 'This link has expired.' };

  user.email_confirmed_at = nowIso();
  delete user.confirmation; // links are single-use
  persist();
  recordEvent('auth.email_confirmed', `${user.email} clicked the verification link`);
  return { ok: true, email: user.email };
}
