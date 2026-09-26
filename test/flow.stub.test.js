/**
 * End-to-end test of stub mode (STUB_ON=true): no emails, registration
 * auto-verifies after stub.autoVerifyAfterSec, sign-in code is stub.otpCode.
 * Runs over HTTP against the sandbox database.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

// Must be set before the app (and its config) is imported.
process.env.APP_MODE = 'sandbox';
process.env.STUB_ON = 'true';
process.env.SANDBOX_STATE_FILE = path.join(os.tmpdir(), `monemapa-stub-test-${process.pid}.json`);

const { default: config } = await import('../src/config/index.js');
const { createApp } = await import('../src/app.js');
const { getState } = await import('../src/sandbox/store.js');

let server;
let base;
const jar = new Map();

async function call(method, url, body) {
  const res = await fetch(base + url, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  for (const header of res.headers.getSetCookie()) {
    const [name, value] = header.split(';')[0].split('=');
    if (value) jar.set(name, value);
    else jar.delete(name);
  }
  const isJson = res.headers.get('content-type')?.includes('application/json');
  return { status: res.status, body: isJson ? await res.json() : null };
}

before(async () => {
  const app = await createApp();
  await new Promise((resolve) => (server = app.listen(0, resolve)));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  fs.rmSync(process.env.SANDBOX_STATE_FILE, { force: true });
});

test('stub mode: register auto-verifies, sign in with the stub code, no emails sent', async () => {
  assert.equal(config.stub.enabled, true);
  const email = 'stub.user@example.com';

  const reg = await call('POST', '/v1/registrations', { name: 'Stub User', email, termsAccepted: true });
  assert.equal(reg.status, 202);
  const { registrationId } = reg.body;

  // Before the delay: still pending
  assert.equal((await call('GET', `/v1/registrations/${registrationId}/status`)).body.status, 'PENDING');

  // Simulate the delay passing, then poll: verified, profile saved, signed in
  const row = getState().tables.registrations.find((r) => r.id === registrationId);
  row.last_sent_at = new Date(Date.now() - (config.stub.autoVerifyAfterSec + 1) * 1000).toISOString();
  const status = await call('GET', `/v1/registrations/${registrationId}/status`);
  assert.equal(status.body.status, 'VERIFIED');
  assert.ok(getState().tables.profiles.some((p) => p.email === email));
  assert.equal((await call('GET', '/v1/me')).body.session.method, 'EMAIL_VERIFICATION');

  // Sign out, then sign in with the stub code
  await call('POST', '/v1/auth/logout', {});
  const otp = await call('POST', '/v1/auth/otp', { email });
  assert.equal(otp.status, 200);

  const wrong = await call('POST', '/v1/auth/otp/verify', { challengeId: otp.body.challengeId, code: '000000' });
  assert.equal(wrong.body.error.code, 'OTP_INVALID'); // attempt limit still applies

  const ok = await call('POST', '/v1/auth/otp/verify', { challengeId: otp.body.challengeId, code: config.stub.otpCode });
  assert.equal(ok.status, 200);
  assert.equal((await call('GET', '/v1/me')).body.session.method, 'ONE_TIME_CODE');

  // Nothing went to the (mock) mail server
  assert.equal(getState().inbox.length, 0);
});

test('stub mode is exposed to the UI via /app-config.json', async () => {
  const res = await fetch(`${base}/app-config.json`).then((r) => r.json());
  assert.deepEqual(res.stub, { enabled: true, otpCode: '123456', autoVerifyAfterSec: 5 });
});
