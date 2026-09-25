/**
 * Small crypto helpers. Random secrets are only ever stored as SHA-256
 * hashes, so a database leak can't be replayed against the API.
 */
import crypto from 'node:crypto';

/** URL-safe random token with `bytes` bytes of entropy. */
export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

export const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

/** Constant-time comparison of a raw secret against a stored hash. */
export function matchesHash(raw, storedHash) {
  if (!raw || !storedHash) return false;
  const a = Buffer.from(sha256(raw), 'hex');
  const b = Buffer.from(storedHash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
