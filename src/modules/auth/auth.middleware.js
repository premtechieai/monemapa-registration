/**
 * `requireAuth` — protects routes that need a signed-in, registered user.
 * On success sets:
 *   req.user         public profile (see users.mapper.js)
 *   req.authSession  { method, startedAt }
 */
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { Errors } from '../../lib/errors.js';
import * as users from '../users/users.repository.js';
import { toPublicUser } from '../users/users.mapper.js';
import { clearSessionCookie, resolveSession } from './session.js';

export const requireAuth = asyncHandler(async (req, res, next) => {
  const session = await resolveSession(req);
  if (!session) {
    clearSessionCookie(res);
    throw Errors.unauthenticated();
  }

  const profile = await users.findById(session.user_id);
  if (!profile || profile.status !== 'ACTIVE') {
    clearSessionCookie(res);
    throw Errors.unauthenticated();
  }

  req.user = toPublicUser(profile);
  req.authSession = { method: session.method, startedAt: session.created_at };
  next();
});
