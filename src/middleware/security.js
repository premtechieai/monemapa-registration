/**
 * HTTP hardening: security headers, rate limiting and a CSRF guard.
 */
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import config from '../config/index.js';
import { AppError } from '../lib/errors.js';

/** Security headers with a CSP that allows only our own assets + Google Fonts. */
export const securityHeaders = helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      'script-src': ["'self'"],
      'style-src': ["'self'", 'https://fonts.googleapis.com'],
      'font-src': ["'self'", 'https://fonts.gstatic.com'],
      'connect-src': ["'self'"],
      'img-src': ["'self'", 'data:'],
    },
  },
});

/** Per-IP limit for the auth API to slow down abuse and enumeration. */
export const apiRateLimit = rateLimit({
  windowMs: config.rateLimit.windowMin * 60 * 1000,
  limit: config.rateLimit.maxRequests,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (_req, _res, next, options) =>
    next(new AppError(429, 'RATE_LIMITED', 'Too many requests. Please slow down.', {
      retryAfterSec: Math.ceil(options.windowMs / 1000),
    })),
});

/**
 * CSRF guard for cookie-authenticated APIs.
 * Browsers can't send a cross-site `application/json` POST without a CORS
 * preflight (which we never approve), so requiring JSON on state-changing
 * requests blocks classic form-post CSRF. SameSite=Lax cookies add a second layer.
 */
export function requireJson(req, _res, next) {
  const mutating = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
  if (mutating && !req.is('application/json')) {
    return next(new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Requests must be sent as JSON.'));
  }
  return next();
}
