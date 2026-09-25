/**
 * Reusable zod building blocks shared by several modules.
 */
import { z } from 'zod';

/** Trimmed, lower-cased email. Messages are shown directly in the UI. */
export const emailField = z
  .string({ required_error: 'Enter your email address.' })
  .trim()
  .toLowerCase()
  .max(254, 'That email address is too long.')
  .email('Enter a valid email address, like jane@company.com.');

export const uuidParam = z.string().uuid('Invalid id.');
