/**
 * Dashboard: the calculator's maths (tests merged from monemapa-main) and the
 * GET /v1/dashboard API + post-login routing over HTTP (sandbox).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

process.env.APP_MODE = 'sandbox';
process.env.STUB_ON = 'true';
process.env.SANDBOX_STATE_FILE = path.join(os.tmpdir(), `monemapa-dash-test-${process.pid}.json`);

const { buildDashboard } = await import('../src/modules/dashboard/dashboard.calculator.js');
const { addMonths, daysInMonth } = await import('../src/lib/dates.js');
const { createApp } = await import('../src/app.js');

// --- Calculator (pure) ----------------------------------------------------------

const categories = [
  { id: 'salary', name: 'Salary', color: '#0a0', type: 'income' },
  { id: 'rent', name: 'Rent', color: '#80f', type: 'expense' },
  { id: 'other', name: 'Other', color: '#888', type: 'both' },
];
const tx = (type, amount, date, categoryId) => ({ id: date + amount, type, amount, description: 'x', date, categoryId, createdAt: date });
const options = { chartMonths: 6, recentTransactions: 5, maxDonutSegments: 5 };

test('month helpers handle year boundaries and leap years', () => {
  assert.equal(addMonths('2026-01', -1), '2025-12');
  assert.equal(addMonths('2026-11', 3), '2027-02');
  assert.equal(daysInMonth('2024-02'), 29);
});

test('KPIs, previous-month comparison and savings rate', () => {
  const d = buildDashboard({
    categories,
    month: '2026-09',
    today: '2026-09-27',
    options,
    transactions: [tx('income', 2000, '2026-09-01', 'salary'), tx('expense', 500, '2026-09-02', 'rent'), tx('income', 1000, '2026-08-01', 'salary'), tx('expense', 250, '2026-08-05', 'rent')],
  });
  assert.deepEqual([d.kpis.income, d.kpis.expense, d.kpis.net], [2000, 500, 1500]);
  assert.equal(d.kpis.savingsRate, 0.75);
  assert.equal(d.kpis.previous.income, 1000);
  assert.equal(d.series.length, 6);
  assert.equal(d.series.at(-1).current, true);
  assert.equal(d.pace.currentDays, 27); // current month stops at "today"
  assert.equal(d.spendingByCategory[0].pct, 100);
});

test('past month shows the full month and no previous data is null', () => {
  const d = buildDashboard({ categories, month: '2026-03', today: '2026-09-27', options, transactions: [tx('expense', 10, '2026-03-04', 'rent')] });
  assert.equal(d.isCurrentMonth, false);
  assert.equal(d.pace.currentDays, 31);
  assert.equal(d.kpis.previous, null);
});

test('unknown categories fall back to "Other"', () => {
  const d = buildDashboard({ categories, month: '2026-09', today: '2026-09-27', options, transactions: [tx('expense', 5, '2026-09-03', 'ghost')] });
  assert.equal(d.spendingByCategory[0].name, 'Other');
});

// --- API + routing (HTTP) ---------------------------------------------------------

let server;
let base;
before(async () => {
  const app = await createApp();
  await new Promise((resolve) => (server = app.listen(0, resolve)));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server.close();
  fs.rmSync(process.env.SANDBOX_STATE_FILE, { force: true });
});

let adaCookie; // one sign-in per test run (the OTP resend cooldown blocks a second one)
async function signInAda() {
  if (adaCookie) return adaCookie;
  const post = (p, body, cookie) =>
    fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
  const otp = await (await post('/v1/auth/otp', { email: 'ada@example.com' })).json();
  const res = await post('/v1/auth/otp/verify', { challengeId: otp.challengeId, code: '123456' });
  adaCookie = res.headers.getSetCookie().find((c) => c.startsWith('mm_sid=')).split(';')[0];
  return adaCookie;
}

test('GET /v1/dashboard needs a session, then returns the computed month', async () => {
  assert.equal((await fetch(`${base}/v1/dashboard`)).status, 401);

  const cookie = await signInAda();
  const today = new Date().toISOString().slice(0, 10);
  const res = await fetch(`${base}/v1/dashboard?month=${today.slice(0, 7)}&today=${today}`, { headers: { Cookie: cookie } });
  assert.equal(res.status, 200);
  const d = await res.json();
  assert.equal(d.month, today.slice(0, 7));
  assert.equal(d.series.length, 6);
  assert.ok(d.kpis.income > 0); // seeded sample salary
  assert.ok(d.recent.length > 0 && d.recent[0].categoryName);

  const bad = await fetch(`${base}/v1/dashboard?month=2026-13`, { headers: { Cookie: cookie } });
  assert.equal(bad.status, 422);
});

test('"/" sends signed-in users to the dashboard, others to registration', async () => {
  const anon = await fetch(`${base}/`, { redirect: 'manual' });
  assert.equal(anon.headers.get('location'), '/register');

  const cookie = await signInAda();
  const signedIn = await fetch(`${base}/`, { redirect: 'manual', headers: { Cookie: cookie } });
  assert.equal(signedIn.headers.get('location'), '/dashboard');
});
