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
 * In sandbox mode (npm run sandbox) no database or SMTP secrets are needed,
 * and a fixed development cookie secret is used if none is configured.
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

const productionSchema = z.object({
  // Database (Supabase Postgres, accessed server-side with the service role key)
  SUPABASE_URL: z
    .string({ required_error: 'SUPABASE_URL is required' })
    .url('SUPABASE_URL must be a valid URL')
    .refine((v) => !v.includes('your-project-ref'), 'SUPABASE_URL still has its placeholder value'),
  SUPABASE_SERVICE_ROLE_KEY: realValue('SUPABASE_SERVICE_ROLE_KEY', 20),

  // Email (SMTP login; host/port/sender live in config/*.json).
  // Optional in stub mode (STUB_ON=true), where no email is sent.
  SMTP_USER: config.stub.enabled ? z.string().optional() : realValue('SMTP_USER', 1),
  SMTP_PASSWORD: config.stub.enabled ? z.string().optional() : realValue('SMTP_PASSWORD', 1),

  // Signs cookies and keys the hashes of one-time codes.
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

  const result = (sandbox ? sandboxSchema : productionSchema).safeParse(merged);
  if (!result.success) {
    const problems = result.error.issues.map((i) => `  - ${i.message}`).join('\n');
    throw new Error(
      `Invalid or missing secrets (looked in ${secretsFile} and the environment):\n${problems}\n` +
        'Fill in secrets/.env (see secrets/.env.example).\n' +
        'Want to try everything locally first? Run `npm run sandbox`.',
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
