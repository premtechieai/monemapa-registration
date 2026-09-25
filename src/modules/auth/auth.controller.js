/**
 * HTTP layer for sign-in. Controllers translate HTTP ⇄ service calls and
 * manage cookies; they contain no business rules.
 */
import * as authService from './auth.service.js';
import { SessionMethod, clearSessionCookies, resolveSession, setSessionCookies } from './session.js';

/** POST /auth/otp  { email } → 200 { challengeId, expiresAt, attemptsLeft, ... } */
export async function requestOtp(req, res) {
  const result = await authService.requestOtp(req.body.email);
  res.status(200).json({ status: 'OTP_SENT', ...result });
}

/** POST /auth/otp/verify  { challengeId, code } → 200 { user, session } + cookies */
export async function verifyOtp(req, res) {
  const { user, session } = await authService.verifyOtp(req.body.challengeId, req.body.code);
  setSessionCookies(res, session, SessionMethod.ONE_TIME_CODE);
  res.status(200).json({
    status: 'AUTHENTICATED',
    user,
    session: { method: SessionMethod.ONE_TIME_CODE, startedAt: session.user.last_sign_in_at },
  });
}

/** POST /auth/logout → 204 */
export async function logout(req, res) {
  const auth = await resolveSession(req, res).catch(() => null);
  await authService.signOut(auth?.accessToken);
  clearSessionCookies(res);
  res.status(204).end();
}
