/**
 * Unit tests for request validation schemas and crypto helpers.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerSchema } from '../src/modules/registration/registration.validators.js';
import { verifyOtpSchema } from '../src/modules/auth/auth.validators.js';
import { matchesHash, randomToken, sha256 } from '../src/lib/crypto.js';

test('registerSchema trims and lower-cases input', () => {
  const parsed = registerSchema.parse({ name: '  Ada Lovelace ', email: ' Ada@Example.COM ', termsAccepted: true });
  assert.deepEqual(parsed, { name: 'Ada Lovelace', email: 'ada@example.com', termsAccepted: true });
});

test('registerSchema reports friendly messages', () => {
  const result = registerSchema.safeParse({ name: 'A', email: 'nope', termsAccepted: false });
  assert.equal(result.success, false);
  const messages = result.error.issues.map((i) => i.message);
  assert.ok(messages.includes('Enter your full name.'));
  assert.ok(messages.includes('Enter a valid email address, like jane@company.com.'));
  assert.ok(messages.includes('Please accept the terms to continue.'));
});

test('verifyOtpSchema requires exactly the configured number of digits', () => {
  const id = '6f1c2b8e-2f4a-4c55-9d7e-1a2b3c4d5e6f';
  assert.equal(verifyOtpSchema.safeParse({ challengeId: id, code: '123456' }).success, true);
  assert.equal(verifyOtpSchema.safeParse({ challengeId: id, code: '12345' }).success, false);
  assert.equal(verifyOtpSchema.safeParse({ challengeId: id, code: '12a456' }).success, false);
  assert.equal(verifyOtpSchema.safeParse({ challengeId: 'not-a-uuid', code: '123456' }).success, false);
});

test('matchesHash only accepts the original secret', () => {
  const secret = randomToken();
  const stored = sha256(secret);
  assert.equal(matchesHash(secret, stored), true);
  assert.equal(matchesHash(randomToken(), stored), false);
  assert.equal(matchesHash(undefined, stored), false);
});
