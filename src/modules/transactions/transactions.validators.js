/**
 * Request schemas for the transactions API.
 */
import { z } from 'zod';
import { uuidParam } from '../../lib/schemas.js';

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date.')
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), 'Pick a valid date.');

export const transactionSchema = z.object({
  type: z.enum(['income', 'expense'], { errorMap: () => ({ message: 'Choose income or expense.' }) }),
  amount: z.coerce
    .number({ invalid_type_error: 'Enter an amount greater than 0.' })
    .positive('Enter an amount greater than 0.')
    .max(1_000_000_000, 'That amount is too large.')
    .transform((v) => Math.round(v * 100) / 100),
  description: z.string().trim().min(1, 'Add a short description.').max(200, 'Keep the description under 200 characters.'),
  date: isoDate,
  categoryId: z.string().min(1, 'Choose a category.'),
  categorySource: z.enum(['ai', 'user', 'rule']).default('user'),
  aiSuggested: z.string().nullish(),
  aiConfidence: z.number().min(0).max(1).nullish(),
  note: z.string().trim().max(500, 'Keep the note under 500 characters.').optional().default(''),
});

export const idParams = z.object({ id: uuidParam });

export const listQuery = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
});

export const suggestSchema = z.object({
  description: z.string().max(200),
  type: z.enum(['income', 'expense']).optional(),
});

export const ruleSchema = z
  .object({
    categoryId: z.string().min(1),
    pattern: z.string().trim().max(80).optional(),
    description: z.string().max(200).optional(),
  })
  .refine((v) => v.pattern || v.description, { message: 'Provide a pattern or description.' });
