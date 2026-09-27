/**
 * Sandbox state: the database rows and "sent" emails, kept in memory and
 * mirrored to a JSON file (config.sandbox.stateFile) so data survives the
 * restarts `node --watch` does on every code change.
 *
 *   tables      profiles / registrations / otp_challenges / sessions rows
 *   inbox       every email "sent" (activation links, sign-in codes)
 *   events      human-readable activity log for the /sandbox page
 *
 * SANDBOX ONLY — never loaded when app.mode is "supabase".
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import config from '../config/index.js';
import { CATEGORIES, sampleTransactions } from './seed-data.js';
import logger from '../lib/logger.js';

// SANDBOX_STATE_FILE lets tests use a throwaway file.
const STATE_FILE = path.resolve(process.cwd(), process.env.SANDBOX_STATE_FILE ?? config.sandbox.stateFile);
const MAX_EVENTS = 200;
// Bump when the stored shape changes; older files are discarded and re-seeded.
const STATE_VERSION = 3;

const nowIso = () => new Date().toISOString();

function emptyState() {
  return {
    version: STATE_VERSION,
    tables: {
      profiles: [],
      registrations: [],
      otp_challenges: [],
      sessions: [],
      categories: [],
      transactions: [],
      category_rules: [],
    },
    inbox: [],
    events: [],
  };
}

/**
 * Pre-registered users (so the "email already registered" path can be tried
 * immediately), the categories, and sample transactions for those users.
 */
function seed(state) {
  state.tables.categories = CATEGORIES.map((c) => ({ ...c }));
  for (const { email, fullName } of config.sandbox.seedUsers) {
    const created = new Date(Date.now() - 12 * 864e5).toISOString();
    const id = crypto.randomUUID();
    state.tables.profiles.push({
      id,
      email,
      full_name: fullName,
      status: 'ACTIVE',
      registered_at: created,
      last_login_at: null,
      updated_at: created,
    });
    state.tables.transactions.push(...sampleTransactions(id));
    state.tables.category_rules.push({ id: crypto.randomUUID(), user_id: id, pattern: 'ikea', category_id: 'household', created_at: created, updated_at: created });
  }
  state.events.unshift({ at: nowIso(), type: 'sandbox.seeded', detail: config.sandbox.seedUsers.map((u) => u.email).join(', ') });
  return state;
}

function loadFromDisk() {
  try {
    const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    if (saved.version === STATE_VERSION) return saved;
  } catch {
    /* first run, or file unreadable */
  }
  return seed(emptyState());
}

let state = loadFromDisk();
let saveTimer = null;

/** Current state. Always call this (don't cache the object — reset() replaces it). */
export const getState = () => state;

/** Write state to disk shortly after the latest change (batches bursts of writes). */
export function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  }, 50);
}

/** Wipe everything and re-seed. */
export function reset() {
  state = seed(emptyState());
  persist();
  logger.info('[sandbox] state reset');
}

/** Add an entry to the activity log shown on /sandbox. */
export function recordEvent(type, detail = '', isError = false) {
  state.events.unshift({ at: nowIso(), type, detail, isError });
  state.events.length = Math.min(state.events.length, MAX_EVENTS);
  persist();
}

/**
 * "Send" an email: store it in the sandbox inbox and print it to the terminal,
 * so flows can be tested from the /sandbox page or straight from the console.
 */
export function deliverMail(mail) {
  const message = { id: crypto.randomUUID(), at: nowIso(), ...mail };
  state.inbox.unshift(message);
  recordEvent(`email.${mail.kind === 'otp' ? 'sign_in_code' : 'activation_link'}`, `sent to ${mail.to}`);

  const payload = mail.kind === 'otp' ? `code ${mail.code}` : mail.link;
  logger.info(`[sandbox] MAIL "${mail.subject}" to ${mail.to}: ${payload}`);
  return message;
}
