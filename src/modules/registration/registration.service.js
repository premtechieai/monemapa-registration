/**
 * RegistrationService — sign up with name + email, confirmed by an email link.
 *
 * Flow:
 *   1. register()   → reject if the email already has an account; otherwise
 *                     Supabase Auth creates the (unconfirmed) user and emails
 *                     a verification link. We store a pending registration.
 *   2. getStatus()  → polled by the browser. Asks Supabase whether the email
 *                     is confirmed; when it is, writes the profile row
 *                     (the permanent registration record) and starts a session.
 *   3. resend()     → emails a fresh link (the previous one stops working).
 *
 * Only the browser that registered can poll: it holds a random secret in an
 * httpOnly cookie, and we store just its hash.
 */
import config from '../../config/index.js';
import { authAdmin } from '../../lib/supabase.js';
import { Errors } from '../../lib/errors.js';
import { matchesHash, randomToken, sha256 } from '../../lib/crypto.js';
import { mapAuthError } from '../../lib/supabaseErrors.js';
import logger from '../../lib/logger.js';
import * as users from '../users/users.repository.js';
import { toPublicUser } from '../users/users.mapper.js';
import { createSessionForEmail } from '../auth/auth.service.js';
import * as registrations from './registration.repository.js';

export const RegistrationStatus = Object.freeze({
  PENDING: 'PENDING',
  VERIFIED: 'VERIFIED',
  EXPIRED: 'EXPIRED',
});

/** Where the verification link lands after Supabase confirms the email. */
const verifiedRedirectUrl = () => `${config.app.baseUrl}${config.routes.verified}`;

const secondsSince = (iso) => (Date.now() - new Date(iso).getTime()) / 1000;
const isExpired = (registration) => new Date(registration.expires_at) <= new Date();
const resendWaitSec = (registration) =>
  Math.max(0, Math.ceil(config.registration.resendCooldownSec - secondsSince(registration.last_sent_at)));

/**
 * Ask Supabase to email a verification link. For a brand-new email this also
 * creates the (unconfirmed) auth user; for an unconfirmed one it re-sends.
 * @returns {Promise<string>} the Supabase auth user id
 */
async function sendVerificationEmail(email, fullName) {
  const { data, error } = await authAdmin.inviteUserByEmail(email, {
    data: { full_name: fullName },
    redirectTo: verifiedRedirectUrl(),
  });
  if (error) throw mapAuthError(error, 'inviteUserByEmail', config.registration.resendCooldownSec);
  return data.user.id;
}

/** Public view of a registration returned to the browser. */
const toPendingResponse = (registration) => ({
  registrationId: registration.id,
  email: registration.email,
  status: registration.status,
  expiresAt: registration.expires_at,
  pollIntervalSec: config.registration.pollIntervalSec,
  resendAvailableInSec: resendWaitSec(registration),
});

/**
 * Step 1 — start a registration.
 * @returns {Promise<{ registration: object, pollSecret: string }>}
 */
export async function register({ name, email }) {
  // Requirement: check whether the email is already registered.
  if (await users.findByEmail(email)) throw Errors.emailExists();

  const pollSecret = randomToken();
  const pollSecretHash = sha256(pollSecret);
  let pending = await registrations.findPendingByEmail(email);

  if (pending && isExpired(pending)) {
    await registrations.markExpired(pending.id);
    pending = null;
  }

  if (pending) {
    // Same email submitted again (new tab, typo fix, etc.). Hand polling to
    // this browser and re-send the link if the cooldown allows.
    const patch = { full_name: name, poll_secret_hash: pollSecretHash };
    if (resendWaitSec(pending) === 0) {
      await sendVerificationEmail(email, name);
      Object.assign(patch, { last_sent_at: new Date().toISOString(), send_count: pending.send_count + 1 });
    }
    const updated = await registrations.update(pending.id, patch);
    logger.info('Registration resumed', { registrationId: updated.id });
    return { registration: toPendingResponse(updated), pollSecret };
  }

  const authUserId = await sendVerificationEmail(email, name);
  const created = await registrations.create({
    email,
    fullName: name,
    authUserId,
    pollSecretHash,
    expiresAt: new Date(Date.now() + config.registration.linkTtlHours * 60 * 60 * 1000),
  });

  logger.info('Registration started, verification email sent', { registrationId: created.id });
  return { registration: toPendingResponse(created), pollSecret };
}

/** Load a registration and check the caller owns it (holds its poll secret). */
async function loadOwned(registrationId, pollSecret) {
  const registration = await registrations.findById(registrationId);
  // Same 404 whether it doesn't exist or isn't theirs — don't reveal which.
  if (!registration || !matchesHash(pollSecret, registration.poll_secret_hash)) throw Errors.notFound('Registration');
  return registration;
}

/**
 * Step 2 — the verification check the browser polls.
 * @returns {Promise<{ status: string, user?: object, session?: object }>}
 *          `session` is present only on the single poll that completed registration.
 */
export async function getStatus(registrationId, pollSecret) {
  const registration = await loadOwned(registrationId, pollSecret);

  if (registration.status === RegistrationStatus.VERIFIED) {
    return { status: RegistrationStatus.VERIFIED, user: toPublicUser(await users.findById(registration.auth_user_id)) };
  }
  if (registration.status === RegistrationStatus.EXPIRED || isExpired(registration)) {
    if (registration.status !== RegistrationStatus.EXPIRED) await registrations.markExpired(registration.id);
    return { status: RegistrationStatus.EXPIRED };
  }

  // Has the user clicked the link? Supabase sets email_confirmed_at when they do.
  const { data, error } = await authAdmin.getUserById(registration.auth_user_id);
  if (error) throw mapAuthError(error, 'getUserById');
  if (!data.user?.email_confirmed_at) {
    return { status: RegistrationStatus.PENDING, resendAvailableInSec: resendWaitSec(registration) };
  }

  // Verified → save the permanent registration record.
  const profile = await users.createFromRegistration({
    id: registration.auth_user_id,
    email: registration.email,
    fullName: registration.full_name,
  });

  // Only the poll that wins this claim creates a session.
  const claimed = await registrations.markVerifiedAndClaimSession(registration.id);
  const session = claimed ? await createSessionForEmail(registration.email) : null;

  logger.info('Registration completed', { registrationId: registration.id, userId: profile.id });
  return { status: RegistrationStatus.VERIFIED, user: toPublicUser(profile), session };
}

/** Step 3 — send a fresh verification link. */
export async function resend(registrationId, pollSecret) {
  const registration = await loadOwned(registrationId, pollSecret);
  if (registration.status !== RegistrationStatus.PENDING || isExpired(registration)) {
    throw Errors.notFound('Pending registration');
  }

  const wait = resendWaitSec(registration);
  if (wait > 0) throw Errors.rateLimited(wait);

  await sendVerificationEmail(registration.email, registration.full_name);
  const updated = await registrations.update(registration.id, {
    last_sent_at: new Date().toISOString(),
    send_count: registration.send_count + 1,
  });

  logger.info('Verification email re-sent', { registrationId: updated.id, sendCount: updated.send_count });
  return toPendingResponse(updated);
}
