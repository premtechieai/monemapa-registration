/**
 * Small crypto helpers. Secrets (verification tokens, session tokens,
 * one-time codes) are only ever stored as hashes, so a database leak can't
 * be replayed against the API.
 */
import crypto from 'node:crypto';

/** URL-safe random token with `bytes` bytes of entropy. */
export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

/** Random numeric code, e.g. "048213" (leading zeros kept). */
export const randomDigits = (length) => Array.from({ length }, () => crypto.randomInt(10)).join('');

/** SHA-256 hex digest — fine for high-entropy random tokens. */
export const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

/**
 * HMAC-SHA-256 hex digest. Used for low-entropy values like 6-digit codes:
 * without the server key, a leaked hash can't be brute-forced offline.
 */
export const hmacSha256 = (value, key) => crypto.createHmac('sha256', key).update(value).digest('hex');

/** Constant-time comparison of two hex digests. */
export function safeEqualHex(a, b) {
  if (!a || !b) return false;
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/** Constant-time check of a raw secret against its stored SHA-256 hash. */
export const matchesHash = (raw, storedHash) => Boolean(raw) && safeEqualHex(sha256(raw), storedHash);
