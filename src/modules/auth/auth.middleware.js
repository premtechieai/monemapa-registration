/**
 * Auth guards.
 *
 *  - `requireAuth`        API routes: 401 JSON when not signed in. On success sets
 *                         req.user (public profile) and req.authSession { method, startedAt }.
 *  - `requirePageSession` HTML pages (the dashboard): redirects to the sign-in
 *                         page when not signed in, so the page never flashes.
 */
import config from '../../config/index.js';
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

export const requirePageSession = asyncHandler(async (req, res, next) => {
  const session = await resolveSession(req);
  const profile = session && (await users.findById(session.user_id));
  if (!profile || profile.status !== 'ACTIVE') {
    clearSessionCookie(res);
    res.set('Cache-Control', 'no-store');
    return res.redirect(config.routes.login);
  }
  return next();
});
