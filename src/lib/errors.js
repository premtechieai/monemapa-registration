/**
 * Application error type + the catalogue of error codes the API can return.
 *
 * Services throw `AppError`s; the central error handler turns them into a
 * consistent JSON response: { error: { code, message, ...details } }.
 * The front end switches on `code`, never on the human-readable message.
 */
export class AppError extends Error {
  /**
   * @param {number} status  HTTP status code
   * @param {string} code    Stable machine-readable code, e.g. EMAIL_EXISTS
   * @param {string} message Human-readable message (safe to show users)
   * @param {object} [details] Extra fields merged into the response body
   */
  constructor(status, code, message, details = {}) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** Factory helpers so services read naturally: `throw Errors.emailExists()`. */
export const Errors = {
  validation: (fields) => new AppError(422, 'INVALID', 'Some fields need attention.', { fields }),
  emailExists: () => new AppError(409, 'EMAIL_EXISTS', 'This email is already registered.'),
  notFound: (what = 'Resource') => new AppError(404, 'NOT_FOUND', `${what} not found.`),
  accountNotFound: () => new AppError(404, 'ACCOUNT_NOT_FOUND', 'No account for this email.'),
  emailNotVerified: () => new AppError(403, 'EMAIL_NOT_VERIFIED', 'Email not verified yet.'),
  rateLimited: (retryAfterSec) =>
    new AppError(429, 'RATE_LIMITED', `Please wait ${retryAfterSec}s before trying again.`, { retryAfterSec }),
  emailQuotaExceeded: () =>
    new AppError(
      503,
      'EMAIL_QUOTA_EXCEEDED',
      "We can't send emails right now because the hourly sending limit was reached. Please try again later.",
    ),
  emailSendFailed: () =>
    new AppError(502, 'EMAIL_SEND_FAILED', "We couldn't send the email just now. Please try again in a moment."),
  otpInvalid: (attemptsLeft) =>
    new AppError(401, 'OTP_INVALID', 'Incorrect code.', { attemptsLeft }),
  otpExpired: () => new AppError(410, 'OTP_EXPIRED', 'This code has expired. Request a new one.'),
  otpLocked: () => new AppError(429, 'OTP_LOCKED', 'Too many attempts. Request a new code.', { attemptsLeft: 0 }),
  unauthenticated: () => new AppError(401, 'UNAUTHENTICATED', 'Please sign in.'),
  upstream: (message = 'Authentication service is unavailable. Try again shortly.') =>
    new AppError(502, 'UPSTREAM_ERROR', message),
};
