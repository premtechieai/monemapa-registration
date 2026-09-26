/**
 * Sandbox-only routes (mounted by app.js only when app.mode is "sandbox"):
 *
 *   GET  /sandbox              inspector page: inbox, database tables, event log
 *   GET  /sandbox/api/state    JSON snapshot the inspector polls
 *   POST /sandbox/api/reset    wipe and re-seed all sandbox data
 *
 * Activation links in the sandbox inbox point at the real /verified page, so
 * the verification path is exactly the one used in production.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { Router } from 'express';
import { sha256 } from '../lib/crypto.js';
import { getState, reset } from './store.js';

const UI_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'ui');
const router = Router();

/** Label each activation email as active / used / replaced / expired for the inspector. */
function linkStatus(mail, state) {
  const token = new URLSearchParams(new URL(mail.link).hash.slice(1)).get('token');
  const tokenHash = token && sha256(token);
  const current = state.tables.registrations.find((r) => r.verification_token_hash === tokenHash);
  if (current) return new Date(current.expires_at) > new Date() ? 'active' : 'expired';
  const registered = state.tables.profiles.some((p) => p.email === mail.to);
  return registered ? 'used' : 'replaced';
}

function snapshot() {
  const state = getState();
  const hideSecrets = ({ poll_secret_hash, verification_token_hash, code_hash, token_hash, ...row }) => row;
  return {
    inbox: state.inbox.map(({ html, ...mail }) => ({
      ...mail,
      linkStatus: mail.kind === 'verify' ? linkStatus(mail, state) : undefined,
    })),
    profiles: state.tables.profiles,
    registrations: state.tables.registrations.map(hideSecrets),
    otpChallenges: state.tables.otp_challenges.map(hideSecrets),
    sessions: state.tables.sessions.map(hideSecrets),
    events: state.events.slice(0, 100),
  };
}

router.use('/sandbox/assets', express.static(UI_DIR));
router.get('/sandbox', (_req, res) => res.sendFile(path.join(UI_DIR, 'sandbox.html')));

router.get('/sandbox/api/state', (_req, res) => res.set('Cache-Control', 'no-store').json(snapshot()));

// Rendered HTML of one inbox message, to preview the real template.
router.get('/sandbox/mail/:id', (req, res) => {
  const mail = getState().inbox.find((m) => m.id === req.params.id);
  if (!mail) return res.status(404).send('Message not found');
  // Emails rely on inline styles; allow those (and nothing executable) for this page only.
  res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src data: https:");
  return res.type('html').send(mail.html);
});

router.post('/sandbox/api/reset', (_req, res) => {
  reset();
  res.status(204).end();
});

export default router;
