/**
 * RegistrationService — sign up with name + email, confirmed by an email link.
 *
 * Flow:
 *   1. register()     → reject if the email already has an account; otherwise
 *                       store a pending registration and email an activation
 *                       link containing a random single-use token.
 *   2. verifyEmail()  → called when the link is opened: creates the profile
 *                       (the permanent registration record).
 *   3. getStatus()    → polled by the registering browser; once verified it
 *                       is allowed to start a session exactly once.
 *   4. resend()       → emails a fresh link (the previous one stops working).
 *
 * Only the browser that registered can poll: it holds a random secret in an
 * httpOnly cookie. Only hashes of the poll secret and link token are stored.
 */
import config from '../../config/index.js';
import { Errors } from '../../lib/errors.js';
import { matchesHash, randomToken, sha256 } from '../../lib/crypto.js';
import logger from '../../lib/logger.js';
import * as users from '../users/users.repository.js';
import { toPublicUser } from '../users/users.mapper.js';
import { sendVerificationEmail } from '../email/email.service.js';
import * as registrations from './registration.repository.js';

export const RegistrationStatus = Object.freeze({
  PENDING: 'PENDING',
  VERIFIED: 'VERIFIED',
  EXPIRED: 'EXPIRED',
});

const secondsSince = (iso) => (Date.now() - new Date(iso).getTime()) / 1000;
const isExpired = (registration) => new Date(registration.expires_at) <= new Date();
const resendWaitSec = (registration) =>
  Math.max(0, Math.ceil(config.registration.resendCooldownSec - secondsSince(registration.last_sent_at)));

/**
 * The activation link. The token travels in the URL *fragment* (#...), which
 * browsers never send to servers, so it stays out of access logs and proxies;
 * the /verified page reads it and POSTs it to the API.
 */
const activationLink = (token) => `${config.app.baseUrl}${config.routes.verified}#token=${encodeURIComponent(token)}`;

/** Create a fresh link token, email it, and return the hash to store. */
async function emailNewLink({ email, name }) {
  const token = randomToken();
  await sendVerificationEmail({ to: email, name, link: activationLink(token) });
  return sha256(token);
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

const newExpiry = () => new Date(Date.now() + config.registration.linkTtlHours * 60 * 60 * 1000);

/**
 * Step 1 — start a registration.
 * @returns {Promise<{ registration: object, pollSecret: string }>}
 */
export async function register({ name, email }) {
  // Requirement: check whether the email is already registered.
  if (await users.findByEmail(email)) throw Errors.emailExists();

  const pollSecret = randomToken();
  let pending = await registrations.findPendingByEmail(email);

  if (pending && isExpired(pending)) {
    await registrations.markExpired(pending.id);
    pending = null;
  }

  if (pending) {
    // Same email submitted again (new tab, typo fix, etc.). Hand polling to
    // this browser and re-send the link if the cooldown allows.
    const patch = { full_name: name, poll_secret_hash: sha256(pollSecret) };
    if (resendWaitSec(pending) === 0) {
      Object.assign(patch, {
        verification_token_hash: await emailNewLink({ email, name }),
        last_sent_at: new Date().toISOString(),
        send_count: pending.send_count + 1,
        expires_at: newExpiry().toISOString(),
      });
    }
    const updated = await registrations.update(pending.id, patch);
    logger.info('Registration resumed', { registrationId: updated.id });
    return { registration: toPendingResponse(updated), pollSecret };
  }

  // Email first: if sending fails, no half-created registration is left behind.
  const verificationTokenHash = await emailNewLink({ email, name });
  const created = await registrations.create({
    email,
    fullName: name,
    pollSecretHash: sha256(pollSecret),
    verificationTokenHash,
    expiresAt: newExpiry(),
  });

  logger.info('Registration started, verification email sent', { registrationId: created.id });
  return { registration: toPendingResponse(created), pollSecret };
}

/**
 * Step 2 — the activation link was opened. Creates the profile.
 * @returns {Promise<{ status: 'VERIFIED', email: string }>}
 */
export async function verifyEmail(token) {
  const registration = await registrations.findByVerificationTokenHash(sha256(token));
  // Unknown, already used, or replaced by a newer link.
  if (!registration || registration.status !== RegistrationStatus.PENDING) throw Errors.linkInvalid();
  if (isExpired(registration)) {
    await registrations.markExpired(registration.id);
    throw Errors.linkExpired();
  }

  if (!(await completeRegistration(registration))) throw Errors.linkInvalid(); // another click won the race
  return { status: RegistrationStatus.VERIFIED, email: registration.email };
}

/**
 * Save the successful registration: create the profile and mark the
 * registration verified. Returns false if it was no longer pending.
 */
async function completeRegistration(registration) {
  const profile = await users.create({ email: registration.email, fullName: registration.full_name });
  const verified = await registrations.markVerified(registration.id, profile.id);
  if (verified) logger.info('Email verified, registration completed', { registrationId: registration.id, userId: profile.id });
  return Boolean(verified);
}

/** Stub mode: treat the email as verified once autoVerifyAfterSec has passed since the (skipped) email. */
const stubAutoVerifyDue = (registration) =>
  config.stub.enabled && secondsSince(registration.last_sent_at) >= config.stub.autoVerifyAfterSec;

/** Load a registration and check the caller owns it (holds its poll secret). */
async function loadOwned(registrationId, pollSecret) {
  const registration = await registrations.findById(registrationId);
  // Same 404 whether it doesn't exist or isn't theirs — don't reveal which.
  if (!registration || !matchesHash(pollSecret, registration.poll_secret_hash)) throw Errors.notFound('Registration');
  return registration;
}

/**
 * Step 3 — the verification check the browser polls.
 * @returns {Promise<{ status: string, user?: object, startSessionFor?: string }>}
 *          `startSessionFor` (a user id) is present only on the single poll
 *          that is allowed to sign the user in.
 */
export async function getStatus(registrationId, pollSecret) {
  let registration = await loadOwned(registrationId, pollSecret);

  // Stub mode (STUB_ON=true): no email was sent, so verify automatically.
  if (registration.status === RegistrationStatus.PENDING && !isExpired(registration) && stubAutoVerifyDue(registration)) {
    logger.info('[stub] Auto-verifying registration', { registrationId });
    await completeRegistration(registration);
    registration = await registrations.findById(registrationId);
  }

  if (registration.status === RegistrationStatus.VERIFIED) {
    // Rows verified before migration 002 have no user_id; match them by email.
    const profile = registration.user_id
      ? await users.findById(registration.user_id)
      : await users.findByEmail(registration.email);
    const claimed = await registrations.claimSession(registration.id);
    return {
      status: RegistrationStatus.VERIFIED,
      user: toPublicUser(profile),
      startSessionFor: claimed ? profile.id : undefined,
    };
  }

  if (registration.status === RegistrationStatus.EXPIRED || isExpired(registration)) {
    if (registration.status !== RegistrationStatus.EXPIRED) await registrations.markExpired(registration.id);
    return { status: RegistrationStatus.EXPIRED };
  }

  return { status: RegistrationStatus.PENDING, resendAvailableInSec: resendWaitSec(registration) };
}

/** Step 4 — send a fresh verification link. */
export async function resend(registrationId, pollSecret) {
  const registration = await loadOwned(registrationId, pollSecret);
  if (registration.status !== RegistrationStatus.PENDING || isExpired(registration)) {
    throw Errors.notFound('Pending registration');
  }

  const wait = resendWaitSec(registration);
  if (wait > 0) throw Errors.rateLimited(wait);

  const updated = await registrations.update(registration.id, {
    verification_token_hash: await emailNewLink({ email: registration.email, name: registration.full_name }),
    last_sent_at: new Date().toISOString(),
    send_count: registration.send_count + 1,
    expires_at: newExpiry().toISOString(),
  });

  logger.info('Verification email re-sent', { registrationId: updated.id, sendCount: updated.send_count });
  return toPendingResponse(updated);
}
