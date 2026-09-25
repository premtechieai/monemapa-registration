/**
 * End-to-end API test of the full registration + OTP sign-in flow, run
 * against the sandbox (in-memory Supabase stand-in) over real HTTP.
 * Exercises the same routes, services and repositories used in production.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

// Must be set before the app (and its config) is imported.
process.env.APP_MODE = 'sandbox';
process.env.SANDBOX_STATE_FILE = path.join(os.tmpdir(), `monemapa-sandbox-test-${process.pid}.json`);

const { createApp } = await import('../src/app.js');
const { getState } = await import('../src/sandbox/store.js');

let server;
let base;

/** Minimal cookie jar: remembers Set-Cookie values between requests. */
const jar = new Map();
function storeCookies(res) {
  for (const header of res.headers.getSetCookie()) {
    const [pair, ...attrs] = header.split(';');
    const [name, value] = pair.split('=');
    const expired = attrs.some((a) => /expires=Thu, 01 Jan 1970/i.test(a)) || value === '';
    if (expired) jar.delete(name.trim());
    else jar.set(name.trim(), value);
  }
}

async function call(method, url, body) {
  const res = await fetch(base + url, {
    method,
    redirect: 'manual',
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  storeCookies(res);
  const isJson = res.headers.get('content-type')?.includes('application/json');
  return { status: res.status, body: isJson ? await res.json() : null, headers: res.headers };
}

const latestMail = (to, kind) => getState().inbox.find((m) => m.to === to && m.kind === kind);

before(async () => {
  const app = await createApp();
  await new Promise((resolve) => (server = app.listen(0, resolve)));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  fs.rmSync(process.env.SANDBOX_STATE_FILE, { force: true });
});

test('seeded email is rejected as already registered', async () => {
  const res = await call('POST', '/v1/registrations', { name: 'Ada Lovelace', email: 'ada@example.com', termsAccepted: true });
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, 'EMAIL_EXISTS');
});

test('full flow: register → verify link → auto sign-in → OTP sign-in → logout', async () => {
  const email = 'grace@example.com';

  // 1. Register → pending, verification email sent
  const reg = await call('POST', '/v1/registrations', { name: 'Grace Hopper', email: 'Grace@Example.com', termsAccepted: true });
  assert.equal(reg.status, 202);
  assert.equal(reg.body.email, email);
  const { registrationId } = reg.body;

  // 2. Poll → still pending
  let status = await call('GET', `/v1/registrations/${registrationId}/status`);
  assert.equal(status.body.status, 'PENDING');

  // Not yet a user, so sign-in says "not verified"
  const early = await call('POST', '/v1/auth/otp', { email });
  assert.equal(early.body.error.code, 'EMAIL_NOT_VERIFIED');

  // 3. Click the emailed link → redirected to the /verified page
  const link = new URL(latestMail(email, 'verify').link);
  const click = await call('GET', link.pathname + link.search);
  assert.equal(click.status, 302);
  assert.match(click.headers.get('location'), /\/verified#type=invite$/);

  // Clicking again → link already used
  const again = await call('GET', link.pathname + link.search);
  assert.match(again.headers.get('location'), /error_code=otp_expired/);

  // 4. Poll → verified, profile saved, session cookie set
  status = await call('GET', `/v1/registrations/${registrationId}/status`);
  assert.equal(status.body.status, 'VERIFIED');
  assert.equal(status.body.user.fullName, 'Grace Hopper');
  assert.equal(getState().tables.profiles.filter((p) => p.email === email).length, 1);

  let me = await call('GET', '/v1/me');
  assert.equal(me.status, 200);
  assert.equal(me.body.session.method, 'EMAIL_VERIFICATION');

  // 5. Sign out
  assert.equal((await call('POST', '/v1/auth/logout', {})).status, 204);
  assert.equal((await call('GET', '/v1/me')).status, 401);

  // 6. OTP sign-in: wrong code, then the right one
  const otp = await call('POST', '/v1/auth/otp', { email });
  assert.equal(otp.status, 200);
  const { challengeId } = otp.body;

  const code = latestMail(email, 'otp').code;
  const wrong = code === '000000' ? '111111' : '000000';
  const bad = await call('POST', '/v1/auth/otp/verify', { challengeId, code: wrong });
  assert.equal(bad.status, 401);
  assert.equal(bad.body.error.attemptsLeft, 4);

  const good = await call('POST', '/v1/auth/otp/verify', { challengeId, code });
  assert.equal(good.status, 200);
  assert.equal(good.body.status, 'AUTHENTICATED');

  me = await call('GET', '/v1/me');
  assert.equal(me.body.session.method, 'ONE_TIME_CODE');
  assert.ok(me.body.user.lastLoginAt);

  // A used code can't be replayed
  const replay = await call('POST', '/v1/auth/otp/verify', { challengeId, code });
  assert.equal(replay.body.error.code, 'OTP_EXPIRED');

  // Immediate resend is throttled by the cooldown
  const resend = await call('POST', '/v1/auth/otp', { email });
  assert.equal(resend.body.error.code, 'RATE_LIMITED');
});

test('OTP locks after the maximum number of wrong attempts', async () => {
  // Fresh seeded user so the resend cooldown from the previous test doesn't apply.
  const otp = await call('POST', '/v1/auth/otp', { email: 'ada@example.com' });
  assert.equal(otp.status, 200);
  const code = latestMail('ada@example.com', 'otp').code;
  const wrong = code === '000000' ? '111111' : '000000';

  let res;
  for (let i = 0; i < 5; i++) res = await call('POST', '/v1/auth/otp/verify', { challengeId: otp.body.challengeId, code: wrong });
  assert.equal(res.body.error.code, 'OTP_LOCKED');

  // Even the right code is refused once locked
  res = await call('POST', '/v1/auth/otp/verify', { challengeId: otp.body.challengeId, code });
  assert.equal(res.body.error.code, 'OTP_LOCKED');
});

test('unknown email gets ACCOUNT_NOT_FOUND', async () => {
  const res = await call('POST', '/v1/auth/otp', { email: 'nobody@example.com' });
  assert.equal(res.status, 404);
  assert.equal(res.body.error.code, 'ACCOUNT_NOT_FOUND');
});
