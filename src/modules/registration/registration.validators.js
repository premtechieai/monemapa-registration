/**
 * Request schemas for the registration endpoints.
 */
import { z } from 'zod';
import { emailField, uuidParam } from '../../lib/schemas.js';

export const registerSchema = z.object({
  name: z
    .string({ required_error: 'Enter your full name.' })
    .trim()
    .min(2, 'Enter your full name.')
    .max(120, 'Name must be 120 characters or fewer.'),
  email: emailField,
  termsAccepted: z.literal(true, {
    errorMap: () => ({ message: 'Please accept the terms to continue.' }),
  }),
});

export const registrationIdParams = z.object({
  id: uuidParam,
});

export const verifyEmailSchema = z.object({
  token: z.string({ required_error: 'Missing verification token.' }).trim().min(20, 'Invalid verification token.').max(200),
});
