/**
 * `requireAuth` — protects routes that need a signed-in, registered user.
 * On success sets:
 *   req.user         public profile (see users.mapper.js)
 *   req.authSession  { method, startedAt }
 *   req.accessToken  raw Supabase JWT (server-side use only, e.g. logout)
 */
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { Errors } from '../../lib/errors.js';
import * as users from '../users/users.repository.js';
import { toPublicUser } from '../users/users.mapper.js';
import { COOKIES, clearSessionCookies, resolveSession } from './session.js';

export const requireAuth = asyncHandler(async (req, res, next) => {
  const auth = await resolveSession(req, res);
  if (!auth) throw Errors.unauthenticated();

  // A valid Supabase user isn't enough — they must have finished registration.
  const profile = await users.findById(auth.user.id);
  if (!profile || profile.status !== 'ACTIVE') {
    clearSessionCookies(res);
    throw Errors.unauthenticated();
  }

  req.user = toPublicUser(profile);
  req.authSession = {
    method: req.signedCookies[COOKIES.method] || null,
    startedAt: auth.user.last_sign_in_at,
  };
  req.accessToken = auth.accessToken;
  next();
});
