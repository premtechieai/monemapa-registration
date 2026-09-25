/**
 * Request validation middleware backed by zod schemas.
 *
 * On success the parsed (trimmed, normalised) value replaces req[source], so
 * controllers only ever see clean data. On failure it throws a 422 with a
 * { field: message } map the UI can show next to each input.
 */
import { Errors } from '../lib/errors.js';

export const validate =
  (schema, source = 'body') =>
  (req, _res, next) => {
    const result = schema.safeParse(req[source] ?? {});
    if (result.success) {
      req[source] = result.data;
      return next();
    }
    const fields = {};
    for (const issue of result.error.issues) {
      const key = issue.path[0] ?? '_';
      fields[key] ??= issue.message; // keep the first message per field
    }
    return next(Errors.validation(fields));
  };
