/**
 * Request schemas for the auth endpoints.
 */
import { z } from 'zod';
import config from '../../config/index.js';
import { emailField } from '../../lib/schemas.js';

export const requestOtpSchema = z.object({
  email: emailField,
});

export const verifyOtpSchema = z.object({
  challengeId: z.string().uuid('Your sign-in request is invalid. Request a new code.'),
  code: z
    .string({ required_error: `Enter all ${config.otp.length} digits.` })
    .trim()
    .regex(new RegExp(`^\\d{${config.otp.length}}$`), `Enter all ${config.otp.length} digits.`),
});
