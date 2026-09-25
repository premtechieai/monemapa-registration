/**
 * Translate Supabase Auth errors into our API errors.
 * Supabase error codes: https://supabase.com/docs/guides/auth/debugging/error-codes
 */
import { Errors } from './errors.js';
import logger from './logger.js';

/**
 * @param {import('@supabase/supabase-js').AuthError} error
 * @param {string} context What we were doing, for the log line.
 * @param {number} [fallbackRetrySec] Retry hint when Supabase rate-limits us.
 */
export function mapAuthError(error, context, fallbackRetrySec = 60) {
  if (error.code === 'email_exists' || error.code === 'user_already_exists') return Errors.emailExists();

  // Project-wide email quota (Supabase's built-in mailer allows ~2 emails/hour).
  // Not the user's fault and not fixed by waiting a minute, so say so plainly.
  if (error.code === 'over_email_send_rate_limit') {
    logger.error(`Supabase email quota reached during ${context}`, {
      code: error.code,
      fix: 'Set up custom SMTP (Authentication > SMTP Settings), then raise Authentication > Rate Limits > emails per hour',
    });
    return Errors.emailQuotaExceeded();
  }

  if (error.status === 429 || String(error.code).startsWith('over_')) {
    logger.warn(`Supabase rate limit during ${context}`, { code: error.code });
    return Errors.rateLimited(fallbackRetrySec);
  }

  logger.error(`Supabase auth error during ${context}`, { status: error.status, code: error.code, message: error.message });
  return Errors.upstream();
}
