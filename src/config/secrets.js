/**
 * Secrets loader.
 *
 * Reads API keys and connection parameters from `secrets/.env` (or the file
 * pointed to by SECRETS_FILE) and validates them. Real environment variables
 * always win over the file, so production can inject secrets through its
 * platform (Docker, Kubernetes, Render, etc.) without shipping a file.
 *
 * The app refuses to start if a secret is missing or malformed — failing fast
 * is far better than failing on the first user request.
 *
 * In sandbox mode (npm run sandbox) no Supabase secrets are needed, and a
 * fixed development cookie secret is used if none is configured.
 */
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';
import config from './index.js';

/** Used only in sandbox mode when COOKIE_SECRET isn't set. Never in production. */
const SANDBOX_COOKIE_SECRET = 'sandbox-only-cookie-secret-not-for-production-use';

const isPlaceholder = (v) => /^replace-with/i.test(v);

/** A string that must not still contain the "replace-with-..." template value. */
const realValue = (name, minLength) =>
  z
    .string({ required_error: `${name} is required` })
    .min(minLength, `${name} must be at least ${minLength} characters`)
    .refine((v) => !isPlaceholder(v), `${name} still has its placeholder value`);

const supabaseSchema = z.object({
  SUPABASE_URL: z
    .string({ required_error: 'SUPABASE_URL is required' })
    .url('SUPABASE_URL must be a valid URL')
    .refine((v) => !v.includes('your-project-ref'), 'SUPABASE_URL still has its placeholder value'),
  SUPABASE_ANON_KEY: realValue('SUPABASE_ANON_KEY', 20),
  SUPABASE_SERVICE_ROLE_KEY: realValue('SUPABASE_SERVICE_ROLE_KEY', 20),
  COOKIE_SECRET: realValue('COOKIE_SECRET', 32),
});

const sandboxSchema = z.object({
  // Fall back to the dev secret when missing, too short, or still a placeholder.
  COOKIE_SECRET: realValue('COOKIE_SECRET', 32).catch(SANDBOX_COOKIE_SECRET),
});

/**
 * Load and validate secrets. Exported as a function (not a module-level
 * constant) so tests can call it with a custom environment.
 *
 * @param {object} [options]
 * @param {string} [options.file] Path to the .env file.
 * @param {NodeJS.ProcessEnv} [options.env] Environment to read from.
 * @param {boolean} [options.sandbox] Validate for sandbox mode.
 */
export function loadSecrets({ file, env = process.env, sandbox = config.isSandbox } = {}) {
  const secretsFile = file ?? env.SECRETS_FILE ?? path.resolve(process.cwd(), 'secrets', '.env');

  // Values from the file only fill gaps; they never overwrite real env vars.
  const fromFile = fs.existsSync(secretsFile) ? dotenv.parse(fs.readFileSync(secretsFile)) : {};
  const merged = { ...fromFile, ...env };

  const result = (sandbox ? sandboxSchema : supabaseSchema).safeParse(merged);
  if (!result.success) {
    const problems = result.error.issues.map((i) => `  - ${i.message}`).join('\n');
    throw new Error(
      `Invalid or missing secrets (looked in ${secretsFile} and the environment):\n${problems}\n` +
        'Fill in secrets/.env with your Supabase project values (Project Settings > API).\n' +
        'No Supabase project yet? Run `npm run sandbox` to try everything locally first.',
    );
  }
  return Object.freeze(result.data);
}

let cached;

/** Process-wide secrets, loaded once on first use. */
export function getSecrets() {
  cached ??= loadSecrets();
  return cached;
}
