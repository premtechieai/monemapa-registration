/**
 * HTTP layer for registration: maps requests to RegistrationService calls
 * and manages the registration + session cookies.
 */
import * as registrationService from './registration.service.js';
import {
  COOKIES,
  SessionMethod,
  clearRegistrationCookie,
  setRegistrationCookie,
  setSessionCookies,
} from '../auth/session.js';

/** POST /registrations  { name, email, termsAccepted } → 202 PENDING */
export async function register(req, res) {
  const { registration, pollSecret } = await registrationService.register(req.body);
  setRegistrationCookie(res, pollSecret);
  res.status(202).json(registration);
}

/** GET /registrations/:id/status → 200 { status, user? } */
export async function getStatus(req, res) {
  const pollSecret = req.cookies[COOKIES.registration];
  const { session, ...result } = await registrationService.getStatus(req.params.id, pollSecret);

  if (session) {
    // Registration just completed: sign the user in and drop the poll cookie.
    setSessionCookies(res, session, SessionMethod.EMAIL_VERIFICATION);
    clearRegistrationCookie(res);
  }
  // Status changes over time — never let a proxy or the browser cache it.
  res.set('Cache-Control', 'no-store').json(result);
}

/** POST /registrations/:id/resend → 202 */
export async function resend(req, res) {
  const pollSecret = req.cookies[COOKIES.registration];
  const registration = await registrationService.resend(req.params.id, pollSecret);
  res.status(202).json(registration);
}
