/**
 * Unit tests for configuration and secrets loading.
 * Run with: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deepMerge, loadConfig } from '../src/config/index.js';
import { loadSecrets } from '../src/config/secrets.js';

const validSecrets = {
  SUPABASE_URL: 'https://abc.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key-0123456789abcdef',
  SMTP_USER: 'resend',
  SMTP_PASSWORD: 're_test_password',
  COOKIE_SECRET: 'x'.repeat(40),
};

test('deepMerge overrides nested keys without dropping siblings', () => {
  const merged = deepMerge({ a: { b: 1, c: 2 }, d: 3 }, { a: { c: 9 } });
  assert.deepEqual(merged, { a: { b: 1, c: 9 }, d: 3 });
});

test('loadConfig applies PORT and APP_BASE_URL overrides', () => {
  const config = loadConfig({ NODE_ENV: 'test', PORT: '4321', APP_BASE_URL: 'https://example.com/' });
  assert.equal(config.app.port, 4321);
  assert.equal(config.app.baseUrl, 'https://example.com');
  assert.equal(config.routes.register, '/register');
});

test('config is frozen', () => {
  const config = loadConfig({ NODE_ENV: 'test' });
  assert.throws(() => {
    'use strict';
    config.otp.length = 4;
  });
});

test('loadSecrets accepts a complete environment', () => {
  const secrets = loadSecrets({ file: 'does-not-exist.env', env: validSecrets, sandbox: false });
  assert.equal(secrets.SUPABASE_URL, validSecrets.SUPABASE_URL);
});

test('loadSecrets rejects missing and placeholder values', () => {
  const env = { ...validSecrets, SUPABASE_SERVICE_ROLE_KEY: 'replace-with-service-role-key' };
  delete env.COOKIE_SECRET;
  assert.throws(
    () => loadSecrets({ file: 'does-not-exist.env', env, sandbox: false }),
    (err) => /COOKIE_SECRET is required/.test(err.message) && /SERVICE_ROLE_KEY still has its placeholder/.test(err.message),
  );
});

test('loadSecrets rejects the template SUPABASE_URL', () => {
  const env = { ...validSecrets, SUPABASE_URL: 'https://your-project-ref.supabase.co' };
  assert.throws(() => loadSecrets({ file: 'does-not-exist.env', env, sandbox: false }), /SUPABASE_URL still has its placeholder/);
});

test('loadSecrets in sandbox mode needs no Supabase keys and defaults the cookie secret', () => {
  const secrets = loadSecrets({ file: 'does-not-exist.env', env: { COOKIE_SECRET: 'replace-with-a-long-random-string' }, sandbox: true });
  assert.ok(secrets.COOKIE_SECRET.length >= 32);
  assert.equal(secrets.SUPABASE_URL, undefined);
});

test('STUB_ON toggles stub mode and rejects bad values', () => {
  assert.equal(loadConfig({}).stub.enabled, false);
  assert.equal(loadConfig({ STUB_ON: 'true' }).stub.enabled, true);
  assert.equal(loadConfig({ STUB_ON: 'false' }).stub.enabled, false);
  assert.throws(() => loadConfig({ STUB_ON: 'maybe' }), /STUB_ON must be true or false/);
});

test('loadConfig switches to sandbox mode via APP_MODE', () => {
  const config = loadConfig({ APP_MODE: 'sandbox' });
  assert.equal(config.isSandbox, true);
  assert.equal(config.otp.resendCooldownSec, 15); // from config/sandbox.json
  assert.throws(() => loadConfig({ APP_MODE: 'bogus' }), /Unknown app.mode/);
});
