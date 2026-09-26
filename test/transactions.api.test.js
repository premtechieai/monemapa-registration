/**
 * Transactions API end to end (sandbox database, over HTTP):
 * CRUD, validation, category/type rules, AI suggestions + learned rules,
 * and that one user can never see or change another user's data.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

process.env.APP_MODE = 'sandbox';
process.env.STUB_ON = 'true'; // sign in with the stub code, no email
process.env.SANDBOX_STATE_FILE = path.join(os.tmpdir(), `monemapa-tx-test-${process.pid}.json`);

const { default: config } = await import('../src/config/index.js');
const { createApp } = await import('../src/app.js');
const { getState } = await import('../src/sandbox/store.js');
const { merchantKey, suggestCategories } = await import('../src/modules/transactions/categorizer.js');

let server;
let base;

/** A tiny HTTP client with its own cookie jar (one per signed-in user). */
function client() {
  const jar = new Map();
  return async (method, url, body) => {
    const res = await fetch(base + url, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') },
      body: body ? JSON.stringify(body) : undefined,
    });
    for (const h of res.headers.getSetCookie()) {
      const [name, value] = h.split(';')[0].split('=');
      if (value) jar.set(name, value);
    }
    const isJson = res.headers.get('content-type')?.includes('application/json');
    return { status: res.status, body: isJson ? await res.json() : null };
  };
}

/** Register (stub auto-verify) and sign in; returns the client. */
async function signedInUser(email) {
  const call = client();
  const reg = await call('POST', '/v1/registrations', { name: 'Test User', email, termsAccepted: true });
  const row = getState().tables.registrations.find((r) => r.id === reg.body.registrationId);
  row.last_sent_at = new Date(Date.now() - 60_000).toISOString();
  await call('GET', `/v1/registrations/${reg.body.registrationId}/status`); // verifies + signs in
  assert.equal((await call('GET', '/v1/me')).status, 200);
  return call;
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

const expense = { type: 'expense', amount: 38.2, description: 'Uber to airport', date: '2026-09-20', categoryId: 'transport', categorySource: 'ai', aiSuggested: 'transport', aiConfidence: 0.94, note: '' };

test('requires a signed-in session', async () => {
  const anon = client();
  assert.equal((await anon('GET', '/v1/transactions')).status, 401);
  assert.equal((await anon('POST', '/v1/transactions', expense)).status, 401);
});

test('create, list, edit, delete and undo (re-create)', async () => {
  assert.equal(config.stub.enabled, true);
  const call = await signedInUser('tx.owner@example.com');

  const initial = await call('GET', '/v1/transactions');
  assert.equal(initial.status, 200);
  assert.equal(initial.body.categories.length, 16);
  assert.equal(initial.body.transactions.length, 0); // new users start empty

  const created = await call('POST', '/v1/transactions', expense);
  assert.equal(created.status, 201);
  assert.equal(created.body.amount, 38.2);
  assert.equal(created.body.categoryId, 'transport');

  const edited = await call('PATCH', `/v1/transactions/${created.body.id}`, { ...expense, amount: 40, note: 'Tip included', categorySource: 'user' });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.amount, 40);
  assert.equal(edited.body.note, 'Tip included');

  const list = await call('GET', '/v1/transactions?from=2026-09-01&to=2026-09-30');
  assert.equal(list.body.transactions.length, 1);
  assert.equal((await call('GET', '/v1/transactions?from=2026-10-01')).body.transactions.length, 0);

  const deleted = await call('DELETE', `/v1/transactions/${created.body.id}`, {});
  assert.equal(deleted.status, 200);
  assert.equal(deleted.body.description, 'Uber to airport'); // returned for Undo
  assert.equal((await call('GET', '/v1/transactions')).body.transactions.length, 0);

  const { id, createdAt, updatedAt, ...fields } = deleted.body;
  assert.equal((await call('POST', '/v1/transactions', fields)).status, 201); // Undo
  assert.equal((await call('GET', '/v1/transactions')).body.transactions.length, 1);
});

test('validation and category/type rules', async () => {
  const call = await signedInUser('tx.validation@example.com');
  const bad = await call('POST', '/v1/transactions', { ...expense, amount: 0, description: ' ', date: 'yesterday' });
  assert.equal(bad.status, 422);
  assert.ok(bad.body.error.fields.amount);
  assert.ok(bad.body.error.fields.description);
  assert.ok(bad.body.error.fields.date);

  const wrongType = await call('POST', '/v1/transactions', { ...expense, categoryId: 'salary' });
  assert.equal(wrongType.status, 422);
  assert.match(wrongType.body.error.fields.categoryId, /can't be used for expense/);

  const unknown = await call('POST', '/v1/transactions', { ...expense, categoryId: 'nope' });
  assert.equal(unknown.status, 422);
});

test('users cannot see or change each other’s transactions', async () => {
  const alice = await signedInUser('alice.tx@example.com');
  const bob = await signedInUser('bob.tx@example.com');
  const mine = await alice('POST', '/v1/transactions', expense);

  assert.equal((await bob('GET', '/v1/transactions')).body.transactions.length, 0);
  assert.equal((await bob('PATCH', `/v1/transactions/${mine.body.id}`, expense)).status, 404);
  assert.equal((await bob('DELETE', `/v1/transactions/${mine.body.id}`, {})).status, 404);
  assert.equal((await alice('GET', '/v1/transactions')).body.transactions.length, 1);
});

test('AI suggestions: keyword model, then a learned rule wins', async () => {
  const call = await signedInUser('tx.ai@example.com');
  let res = await call('POST', '/v1/transactions/suggest', { description: 'Starbucks latte', type: 'expense' });
  assert.equal(res.body.suggestions[0].categoryId, 'coffee');
  assert.equal(res.body.suggestions[0].source, 'model');

  const rule = await call('PUT', '/v1/category-rules', { description: 'Starbucks latte', categoryId: 'dining' });
  assert.deepEqual(rule.body, { pattern: 'starbucks latte', categoryId: 'dining' });

  res = await call('POST', '/v1/transactions/suggest', { description: 'Starbucks latte', type: 'expense' });
  assert.deepEqual(res.body.suggestions[0], { categoryId: 'dining', confidence: 0.99, source: 'rule' });
  assert.equal((await call('GET', '/v1/transactions')).body.rules.length, 1);

  // Too short → no suggestions
  assert.deepEqual((await call('POST', '/v1/transactions/suggest', { description: 'ab' })).body.suggestions, []);
});

test('categorizer unit behaviour', () => {
  assert.equal(merchantKey('Uber to airport'), 'uber');
  assert.equal(merchantKey('Invoice #1042 — Studio Nord'), 'invoice');
  const categories = getState().tables.categories;
  const out = suggestCategories({ description: 'Salary payroll', type: 'income', categories, rules: [], history: [] });
  assert.equal(out[0].categoryId, 'salary');
  // Income categories are never suggested for expenses
  const exp = suggestCategories({ description: 'Salary payroll', type: 'expense', categories, rules: [], history: [] });
  assert.ok(!exp.some((s) => s.categoryId === 'salary'));
});
