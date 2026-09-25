/**
 * AuthService — passwordless sign-in with an emailed one-time code.
 *
 * Flow:
 *   1. requestOtp(email)       → Supabase emails a code; we open a "challenge"
 *   2. verifyOtp(id, code)     → we spend one attempt, Supabase checks the code,
 *                                and on success a session is returned
 *
 * Supabase generates, emails and validates the code. The challenge row adds
 * the rules the product needs on top: a shorter expiry, a hard attempt limit
 * and a resend cooldown.
 */
import config from '../../config/index.js';
import { authAdmin, createAuthClient } from '../../lib/supabase.js';
import { Errors } from '../../lib/errors.js';
import { mapAuthError } from '../../lib/supabaseErrors.js';
import logger from '../../lib/logger.js';
import * as users from '../users/users.repository.js';
import * as registrations from '../registration/registration.repository.js';
import { toPublicUser } from '../users/users.mapper.js';
import * as otpChallenges from './otp.repository.js';

const secondsSince = (iso) => (Date.now() - new Date(iso).getTime()) / 1000;

/** Step 1: email a sign-in code to a registered, verified user. */
export async function requestOtp(email) {
  const profile = await users.findByEmail(email);

  if (!profile) {
    // Tell the user *why* so the UI can offer the right next step.
    const pending = await registrations.findPendingByEmail(email);
    throw pending ? Errors.emailNotVerified() : Errors.accountNotFound();
  }
  if (profile.status !== 'ACTIVE') throw Errors.accountNotFound();

  // Resend cooldown: one code per email per `resendCooldownSec`.
  const latest = await otpChallenges.findLatestForEmail(email);
  if (latest) {
    const wait = Math.ceil(config.otp.resendCooldownSec - secondsSince(latest.created_at));
    if (wait > 0) throw Errors.rateLimited(wait);
  }

  // Any earlier code for this email stops working once a new one is requested.
  await otpChallenges.revokeOpenForEmail(email);

  const { error } = await createAuthClient().signInWithOtp({
    email,
    options: { shouldCreateUser: false }, // sign-in only; registration is a separate flow
  });
  if (error) throw mapAuthError(error, 'signInWithOtp', config.otp.resendCooldownSec);

  const challenge = await otpChallenges.create({
    userId: profile.id,
    email,
    attemptsLeft: config.otp.maxAttempts,
    expiresAt: new Date(Date.now() + config.otp.ttlSec * 1000),
  });

  logger.info('OTP sent', { userId: profile.id, challengeId: challenge.id });
  return {
    challengeId: challenge.id,
    email,
    expiresAt: challenge.expires_at,
    attemptsLeft: challenge.attempts_left,
    otpLength: config.otp.length,
    resendAvailableInSec: config.otp.resendCooldownSec,
  };
}

/** Step 2: check the code. Returns { user, session } on success. */
export async function verifyOtp(challengeId, code) {
  const challenge = await otpChallenges.findById(challengeId);
  if (!challenge) throw Errors.notFound('Sign-in request');
  if (challenge.consumed_at || challenge.revoked_at) throw Errors.otpExpired();
  if (new Date(challenge.expires_at) <= new Date()) throw Errors.otpExpired();
  if (challenge.attempts_left <= 0) throw Errors.otpLocked();

  // Spend the attempt *before* checking the code so parallel guesses can't
  // exceed the limit.
  const attemptsLeft = await otpChallenges.spendAttempt(challengeId);
  if (attemptsLeft < 0) throw Errors.otpLocked();

  const { data, error } = await createAuthClient().verifyOtp({ email: challenge.email, token: code, type: 'email' });

  if (error) {
    if (error.status >= 500 || !error.status) throw mapAuthError(error, 'verifyOtp');
    // Wrong or (Supabase-side) expired code.
    logger.info('OTP rejected', { challengeId, attemptsLeft });
    throw attemptsLeft === 0 ? Errors.otpLocked() : Errors.otpInvalid(attemptsLeft);
  }

  await otpChallenges.markConsumed(challengeId);
  const profile = await users.touchLastLogin(challenge.user_id);

  logger.info('OTP sign-in succeeded', { userId: profile.id });
  return { user: toPublicUser(profile), session: data.session };
}

/**
 * Create a Supabase session for a user without them typing a code.
 *
 * Used exactly once, right after the verification poll sees the email
 * confirmed, so "Go to dashboard" works without an extra sign-in. The admin
 * API generates a magic-link token server-side (no email is sent) and we
 * immediately redeem it.
 */
export async function createSessionForEmail(email) {
  const { data: link, error: linkError } = await authAdmin.generateLink({ type: 'magiclink', email });
  if (linkError) throw mapAuthError(linkError, 'generateLink');

  const { data, error } = await createAuthClient().verifyOtp({
    token_hash: link.properties.hashed_token,
    type: 'magiclink',
  });
  if (error) throw mapAuthError(error, 'verifyOtp(token_hash)');
  return data.session;
}

/** Revoke the session's refresh token in Supabase. Best-effort. */
export async function signOut(accessToken) {
  if (!accessToken) return;
  const { error } = await authAdmin.signOut(accessToken, 'local');
  if (error) logger.warn('Supabase signOut failed', { message: error.message });
}
