/**
 * AuthService — passwordless sign-in with an emailed one-time code.
 *
 * Flow:
 *   1. requestOtp(email)    → generate a code, store its HMAC in a new
 *                             "challenge", email the code (SMTP)
 *   2. verifyOtp(id, code)  → spend one attempt, compare hashes; on success
 *                             the caller starts a session
 *
 * Rules: codes expire after otp.ttlSec, allow otp.maxAttempts wrong guesses,
 * can be re-requested every otp.resendCooldownSec, and requesting a new code
 * revokes the previous one.
 */
import config from '../../config/index.js';
import { getSecrets } from '../../config/secrets.js';
import { Errors } from '../../lib/errors.js';
import { hmacSha256, randomDigits, safeEqualHex } from '../../lib/crypto.js';
import logger from '../../lib/logger.js';
import * as users from '../users/users.repository.js';
import * as registrations from '../registration/registration.repository.js';
import { toPublicUser } from '../users/users.mapper.js';
import { sendSignInCode } from '../email/email.service.js';
import * as otpChallenges from './otp.repository.js';

const secondsSince = (iso) => (Date.now() - new Date(iso).getTime()) / 1000;

/** Keyed hash of a code: a leaked table can't be brute-forced without the server secret. */
const hashCode = (code) => hmacSha256(code, getSecrets().COOKIE_SECRET);

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
  if (latest && !latest.revoked_at) {
    const wait = Math.ceil(config.otp.resendCooldownSec - secondsSince(latest.created_at));
    if (wait > 0) throw Errors.rateLimited(wait);
  }

  // Any earlier code for this email stops working once a new one is requested.
  await otpChallenges.revokeOpenForEmail(email);

  // Stub mode uses a fixed, known code (config.stub.otpCode). Everything else
  // — hashing, expiry, attempt limit — works exactly as in live mode.
  const code = config.stub.enabled ? config.stub.otpCode : randomDigits(config.otp.length);
  const challenge = await otpChallenges.create({
    userId: profile.id,
    email,
    codeHash: hashCode(code),
    attemptsLeft: config.otp.maxAttempts,
    expiresAt: new Date(Date.now() + config.otp.ttlSec * 1000),
  });

  try {
    await sendSignInCode({ to: email, code });
  } catch (err) {
    // No email, no usable code: revoke it so the cooldown doesn't block a retry.
    await otpChallenges.revoke(challenge.id);
    throw err;
  }

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

/** Step 2: check the code. Returns the signed-in user's profile. */
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

  if (!safeEqualHex(hashCode(code), challenge.code_hash)) {
    logger.info('OTP rejected', { challengeId, attemptsLeft });
    throw attemptsLeft === 0 ? Errors.otpLocked() : Errors.otpInvalid(attemptsLeft);
  }

  await otpChallenges.markConsumed(challengeId);
  const profile = await users.touchLastLogin(challenge.user_id);

  logger.info('OTP sign-in succeeded', { userId: profile.id });
  return toPublicUser(profile);
}
