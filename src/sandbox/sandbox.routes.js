/**
 * Sandbox-only routes (mounted by app.js only when app.mode is "sandbox"):
 *
 *   GET  /sandbox              inspector page: inbox, database tables, event log
 *   GET  /sandbox/api/state    JSON snapshot the inspector polls
 *   POST /sandbox/api/reset    wipe and re-seed all sandbox data
 *   GET  /sandbox/auth/verify  target of the emailed verification link —
 *                              plays the part of Supabase's /verify endpoint
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { Router } from 'express';
import config from '../config/index.js';
import { confirmEmailByToken } from './fakeAuth.js';
import { getState, reset } from './store.js';

const UI_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'ui');
const router = Router();

/** Label each verification email as active / used / replaced for the inspector. */
function linkStatus(mail, state) {
  const user = state.authUsers.find((u) => u.email === mail.to);
  if (user?.confirmation?.tokenHash === mail.tokenHash) return 'active';
  return user?.email_confirmed_at ? 'used' : 'replaced';
}

function snapshot() {
  const state = getState();
  return {
    inbox: state.inbox.map(({ tokenHash, ...mail }) => ({
      ...mail,
      linkStatus: mail.kind === 'verify' ? linkStatus({ tokenHash, ...mail }, state) : undefined,
    })),
    profiles: state.tables.profiles,
    // The poll secret hash is irrelevant for testing; keep the table readable.
    registrations: state.tables.registrations.map(({ poll_secret_hash, ...r }) => r),
    otpChallenges: state.tables.otp_challenges,
    events: state.events.slice(0, 100),
  };
}

router.use('/sandbox/assets', express.static(UI_DIR));
router.get('/sandbox', (_req, res) => res.sendFile(path.join(UI_DIR, 'sandbox.html')));

router.get('/sandbox/api/state', (_req, res) => res.set('Cache-Control', 'no-store').json(snapshot()));

router.post('/sandbox/api/reset', (_req, res) => {
  reset();
  res.status(204).end();
});

router.get('/sandbox/auth/verify', (req, res) => {
  // Only ever redirect back into this app (no open redirect).
  const fallback = `${config.app.baseUrl}${config.routes.verified}`;
  const target = String(req.query.redirect_to ?? '');
  const redirectTo = target.startsWith(config.app.baseUrl) ? target : fallback;

  const result = confirmEmailByToken(req.query.token);
  if (result.ok) return res.redirect(`${redirectTo}#type=invite`);

  // Same fragment format Supabase uses for a bad or expired link.
  const params = new URLSearchParams({ error: 'access_denied', error_code: 'otp_expired', error_description: result.reason });
  return res.redirect(`${redirectTo}#${params}`);
});

export default router;
