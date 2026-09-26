/**
 * Registration routes.
 *
 * Mounted under /v1/registrations:
 *   POST /              start registration, email link   202 PENDING · 409 EMAIL_EXISTS · 422 INVALID
 *   GET  /:id/status    polled until email is verified   200 PENDING | VERIFIED | EXPIRED
 *   POST /:id/resend    send a fresh link (cooldown)     202 · 429 RATE_LIMITED
 *
 * Mounted under /v1/verifications:
 *   POST /              { token } from the emailed link  200 VERIFIED · 404 LINK_INVALID · 410 LINK_EXPIRED
 */
import { Router } from 'express';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { validate } from '../../middleware/validate.js';
import * as controller from './registration.controller.js';
import { registerSchema, registrationIdParams, verifyEmailSchema } from './registration.validators.js';

export const registrationRoutes = Router();
registrationRoutes.post('/', validate(registerSchema), asyncHandler(controller.register));
registrationRoutes.get('/:id/status', validate(registrationIdParams, 'params'), asyncHandler(controller.getStatus));
registrationRoutes.post('/:id/resend', validate(registrationIdParams, 'params'), asyncHandler(controller.resend));

export const verificationRoutes = Router();
verificationRoutes.post('/', validate(verifyEmailSchema), asyncHandler(controller.verifyEmail));
