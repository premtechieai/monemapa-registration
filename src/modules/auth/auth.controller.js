/**
 * HTTP layer for sign-in. Controllers translate HTTP ⇄ service calls and
 * manage cookies; they contain no business rules.
 */
import * as authService from './auth.service.js';
import { SessionMethod, endSession, startSession } from './session.js';

/** POST /auth/otp  { email } → 200 { challengeId, expiresAt, attemptsLeft, ... } */
export async function requestOtp(req, res) {
  const result = await authService.requestOtp(req.body.email);
  res.status(200).json({ status: 'OTP_SENT', ...result });
}

/** POST /auth/otp/verify  { challengeId, code } → 200 { user, session } + session cookie */
export async function verifyOtp(req, res) {
  const user = await authService.verifyOtp(req.body.challengeId, req.body.code);
  const session = await startSession(res, user.id, SessionMethod.ONE_TIME_CODE);
  res.status(200).json({ status: 'AUTHENTICATED', user, session });
}

/** POST /auth/logout → 204 */
export async function logout(req, res) {
  await endSession(req, res);
  res.status(204).end();
}
