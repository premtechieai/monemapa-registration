/**
 * Registration routes (mounted under /v1/registrations).
 *
 *   POST /              start registration, email link   202 PENDING · 409 EMAIL_EXISTS · 422 INVALID
 *   GET  /:id/status    polled until email is verified   200 PENDING | VERIFIED | EXPIRED
 *   POST /:id/resend    send a fresh link (cooldown)     202 · 429 RATE_LIMITED
 */
import { Router } from 'express';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { validate } from '../../middleware/validate.js';
import * as controller from './registration.controller.js';
import { registerSchema, registrationIdParams } from './registration.validators.js';

const router = Router();

router.post('/', validate(registerSchema), asyncHandler(controller.register));
router.get('/:id/status', validate(registrationIdParams, 'params'), asyncHandler(controller.getStatus));
router.post('/:id/resend', validate(registrationIdParams, 'params'), asyncHandler(controller.resend));

export default router;
