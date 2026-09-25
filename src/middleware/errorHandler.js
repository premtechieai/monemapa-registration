/**
 * Central error handling. Every error leaves the API in the same shape:
 *   { "error": { "code": "EMAIL_EXISTS", "message": "...", ...details } }
 * Unexpected errors are logged in full but only a generic message is returned.
 */
import { AppError } from '../lib/errors.js';
import logger from '../lib/logger.js';

export function notFoundHandler(req, _res, next) {
  next(new AppError(404, 'NOT_FOUND', `No route for ${req.method} ${req.path}`));
}

// eslint-disable-next-line no-unused-vars -- Express needs the 4-arg signature
export function errorHandler(err, req, res, _next) {
  // Malformed JSON body from express.json()
  if (err.type === 'entity.parse.failed') {
    err = new AppError(400, 'BAD_JSON', 'Request body is not valid JSON.');
  }

  if (err instanceof AppError) {
    if (err.status >= 500) logger.warn(`${req.method} ${req.path} → ${err.code}`, { message: err.message });
    return res.status(err.status).json({ error: { code: err.code, message: err.message, ...err.details } });
  }

  logger.error(`Unhandled error on ${req.method} ${req.path}`, { message: err.message, stack: err.stack });
  return res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong. Please try again.' } });
}
