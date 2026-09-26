/**
 * Application configuration (non-secret settings).
 *
 * Load order — later sources override earlier ones:
 *   1. config/default.json          shared defaults
 *   2. config/<NODE_ENV>.json       per-environment overrides (optional)
 *   3. a few environment variables  (PORT, APP_BASE_URL, APP_MODE, STUB_ON);
 *      these may also be set in secrets/.env, real env vars win
 *   4. config/sandbox.json          only when app.mode is "sandbox"
 *
 * URLs, routes, timings and limits all live here so they can be changed
 * without touching code. Secrets live in ./secrets.js, never here.
 */
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

const CONFIG_DIR = path.resolve(process.cwd(), 'config');

/** process.env, with values from the secrets/.env file filling any gaps. */
function defaultEnv() {
  const file = process.env.SECRETS_FILE ?? path.resolve(process.cwd(), 'secrets', '.env');
  const fromFile = fs.existsSync(file) ? dotenv.parse(fs.readFileSync(file)) : {};
  return { ...fromFile, ...process.env };
}

/** Parse "true"/"false"/"1"/"0"/"yes"/"no"/"on"/"off" (case-insensitive). */
function parseBool(name, value) {
  const v = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(v)) return true;
  if (['false', '0', 'no', 'off', ''].includes(v)) return false;
  throw new Error(`${name} must be true or false (got "${value}")`);
}

function readJson(file) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
}

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Recursively merge `override` into `base`, returning a new object. */
export function deepMerge(base, override) {
  const out = { ...base };
  for (const [key, value] of Object.entries(override)) {
    out[key] = isPlainObject(value) && isPlainObject(base[key]) ? deepMerge(base[key], value) : value;
  }
  return out;
}

/** Freeze an object and all nested objects so config can't be mutated at runtime. */
function deepFreeze(obj) {
  Object.values(obj).forEach((v) => isPlainObject(v) && deepFreeze(v));
  return Object.freeze(obj);
}

export function loadConfig(env = defaultEnv()) {
  const nodeEnv = env.NODE_ENV || 'development';

  let config = deepMerge(readJson(path.join(CONFIG_DIR, 'default.json')), readJson(path.join(CONFIG_DIR, `${nodeEnv}.json`)));

  // Deploy platforms commonly inject these; honour them when present.
  const envOverrides = { app: {} };
  if (env.PORT) envOverrides.app.port = Number(env.PORT);
  if (env.APP_BASE_URL) envOverrides.app.baseUrl = env.APP_BASE_URL.replace(/\/$/, '');
  if (env.APP_MODE) envOverrides.app.mode = env.APP_MODE;
  if (env.STUB_ON !== undefined) envOverrides.stub = { enabled: parseBool('STUB_ON', env.STUB_ON) };
  config = deepMerge(config, envOverrides);

  // Stub mode: fixed sign-in code — it must fit the configured code length.
  if (config.stub.enabled && !new RegExp(`^\\d{${config.otp.length}}$`).test(config.stub.otpCode)) {
    throw new Error(`stub.otpCode "${config.stub.otpCode}" must be ${config.otp.length} digits (otp.length)`);
  }

  // Sandbox mode = run locally against an in-memory Supabase stand-in
  // (see src/sandbox). config/sandbox.json holds sandbox-only tweaks.
  if (!['supabase', 'sandbox'].includes(config.app.mode)) {
    throw new Error(`Unknown app.mode "${config.app.mode}" — use "supabase" or "sandbox".`);
  }
  if (config.app.mode === 'sandbox') config = deepMerge(config, readJson(path.join(CONFIG_DIR, 'sandbox.json')));

  config.env = nodeEnv;
  config.isProduction = nodeEnv === 'production';
  config.isSandbox = config.app.mode === 'sandbox';
  return deepFreeze(config);
}

const config = loadConfig();
export default config;
