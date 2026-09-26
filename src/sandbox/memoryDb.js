/**
 * In-memory stand-in for the Supabase database client (`db.from(...)`, `db.rpc(...)`).
 *
 * Implements exactly the query-builder calls the repositories use —
 * select / insert / update / upsert, eq / is, order / limit,
 * single / maybeSingle — with the same { data, error } result shape, and
 * emulates the migration's defaults, unique constraints and the
 * spend_otp_attempt() function. The repositories therefore run unchanged.
 *
 * SANDBOX ONLY.
 */
import crypto from 'node:crypto';
import { getState, persist, recordEvent } from './store.js';

const nowIso = () => new Date().toISOString();
const clone = (v) => structuredClone(v);

/**
 * Per-table column defaults and unique constraints, mirroring
 * supabase/migrations/001 and 002.
 */
const SCHEMA = {
  profiles: {
    defaults: () => ({
      id: crypto.randomUUID(),
      status: 'ACTIVE',
      registered_at: nowIso(),
      last_login_at: null,
      updated_at: nowIso(),
    }),
    unique: [{ cols: ['id'] }, { cols: ['email'] }],
    touchUpdatedAt: true,
  },
  registrations: {
    defaults: () => ({
      id: crypto.randomUUID(),
      status: 'PENDING',
      user_id: null,
      verification_token_hash: null,
      last_sent_at: nowIso(),
      send_count: 1,
      verified_at: null,
      session_issued_at: null,
      created_at: nowIso(),
    }),
    unique: [
      { cols: ['id'] },
      // registrations_one_pending_per_email (partial unique index)
      { cols: ['email'], where: (r) => r.status === 'PENDING' },
      { cols: ['verification_token_hash'], where: (r) => r.verification_token_hash != null },
    ],
  },
  otp_challenges: {
    defaults: () => ({ id: crypto.randomUUID(), consumed_at: null, revoked_at: null, created_at: nowIso() }),
    unique: [{ cols: ['id'] }],
  },
  sessions: {
    defaults: () => ({ id: crypto.randomUUID(), created_at: nowIso(), revoked_at: null }),
    unique: [{ cols: ['id'] }, { cols: ['token_hash'] }],
  },
};

/** PostgREST-style error objects. */
const pgError = (code, message) => ({ code, message, details: null, hint: null });

/** Throw if `row` would break a unique constraint against the other rows. */
function assertUnique(table, row, others) {
  for (const { cols, where } of SCHEMA[table].unique) {
    if (where && !where(row)) continue;
    const clash = others.find((o) => (!where || where(o)) && cols.every((c) => o[c] === row[c]));
    if (clash) throw pgError('23505', `duplicate key value violates unique constraint on ${table}(${cols.join(', ')})`);
  }
}

class Query {
  constructor(table) {
    if (!SCHEMA[table]) throw new Error(`[sandbox] unknown table "${table}"`);
    this.table = table;
    this.action = 'select';
    this.filters = [];
    this.returning = false;
    this.resultMode = 'many';
  }

  // --- builders (chainable, like supabase-js) ------------------------------
  select() {
    this.returning = true;
    return this;
  }
  insert(values) {
    this.action = 'insert';
    this.payload = [values].flat();
    return this;
  }
  update(patch) {
    this.action = 'update';
    this.payload = patch;
    return this;
  }
  upsert(values, options = {}) {
    this.action = 'upsert';
    this.payload = [values].flat();
    this.options = options;
    return this;
  }
  eq(column, value) {
    this.filters.push((r) => r[column] === value);
    return this;
  }
  is(column, value) {
    this.filters.push((r) => r[column] === value);
    return this;
  }
  order(column, { ascending = true } = {}) {
    this.sort = { column, ascending };
    return this;
  }
  limit(count) {
    this.max = count;
    return this;
  }
  single() {
    this.resultMode = 'single';
    return this;
  }
  maybeSingle() {
    this.resultMode = 'maybeSingle';
    return this;
  }

  // Awaiting the builder runs the query (supabase-js builders are thenables too).
  then(resolve, reject) {
    return Promise.resolve()
      .then(() => this.execute())
      .then(resolve, reject);
  }

  // --- execution ------------------------------------------------------------
  execute() {
    try {
      return this.shape(this.run());
    } catch (error) {
      return { data: null, error };
    }
  }

  get rows() {
    return getState().tables[this.table];
  }

  matches(row) {
    return this.filters.every((f) => f(row));
  }

  run() {
    switch (this.action) {
      case 'select':
        return this.runSelect();
      case 'insert':
        return this.payload.map((values) => this.insertRow(values));
      case 'update':
        return this.runUpdate();
      case 'upsert':
        return this.runUpsert();
      default:
        throw new Error(`[sandbox] unsupported action ${this.action}`);
    }
  }

  runSelect() {
    let result = this.rows.filter((r) => this.matches(r));
    if (this.sort) {
      const { column, ascending } = this.sort;
      result = [...result].sort((a, b) => (a[column] < b[column] ? -1 : a[column] > b[column] ? 1 : 0) * (ascending ? 1 : -1));
    }
    return this.max != null ? result.slice(0, this.max) : result;
  }

  insertRow(values) {
    const row = { ...SCHEMA[this.table].defaults(), ...values };
    assertUnique(this.table, row, this.rows);
    this.rows.push(row);
    persist();
    recordEvent(`db.${this.table}.insert`, row.email ?? row.id);
    return row;
  }

  runUpdate() {
    const targets = this.rows.filter((r) => this.matches(r));
    for (const row of targets) {
      const updated = { ...row, ...this.payload };
      if (SCHEMA[this.table].touchUpdatedAt) updated.updated_at = nowIso();
      assertUnique(this.table, updated, this.rows.filter((r) => r !== row));
      Object.assign(row, updated);
    }
    if (targets.length) {
      persist();
      recordEvent(`db.${this.table}.update`, `${Object.keys(this.payload).join(', ')} · ${targets.length} row(s)`);
    }
    return targets;
  }

  runUpsert() {
    const conflictColumn = this.options.onConflict ?? 'id';
    return this.payload.flatMap((values) => {
      const existing = this.rows.find((r) => r[conflictColumn] === values[conflictColumn]);
      if (!existing) return [this.insertRow(values)];
      if (this.options.ignoreDuplicates) return [];
      Object.assign(existing, values);
      persist();
      return [existing];
    });
  }

  /** Apply single()/maybeSingle() and whether rows are returned at all. */
  shape(rows) {
    if (this.action !== 'select' && !this.returning) return { data: null, error: null };
    if (this.resultMode === 'many') return { data: clone(rows), error: null };
    if (rows.length > 1 || (this.resultMode === 'single' && rows.length === 0)) {
      return { data: null, error: pgError('PGRST116', `JSON object requested, ${rows.length} rows returned`) };
    }
    return { data: rows.length ? clone(rows[0]) : null, error: null };
  }
}

/** Postgres functions from the migration. */
const FUNCTIONS = {
  // Same semantics as public.spend_otp_attempt: attempts left after spending, or -1.
  spend_otp_attempt({ p_challenge_id }) {
    const row = getState().tables.otp_challenges.find((r) => r.id === p_challenge_id);
    const spendable =
      row && !row.consumed_at && !row.revoked_at && new Date(row.expires_at) > new Date() && row.attempts_left > 0;
    if (!spendable) return -1;
    row.attempts_left -= 1;
    persist();
    return row.attempts_left;
  },
};

export const memoryDb = {
  from: (table) => new Query(table),
  async rpc(name, args) {
    const fn = FUNCTIONS[name];
    if (!fn) return { data: null, error: pgError('PGRST202', `function ${name} not found`) };
    return { data: fn(args), error: null };
  },
};
