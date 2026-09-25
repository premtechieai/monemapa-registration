/**
 * Sign-in routes (mounted under /v1/auth).
 *
 *   POST /otp          send a one-time code       200 OTP_SENT · 404 ACCOUNT_NOT_FOUND · 403 EMAIL_NOT_VERIFIED · 429
 *   POST /otp/verify   check code, start session  200 AUTHENTICATED · 401 OTP_INVALID · 410 OTP_EXPIRED · 429 OTP_LOCKED
 *   POST /logout       end session                204
 */
import { Router } from 'express';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { validate } from '../../middleware/validate.js';
import * as controller from './auth.controller.js';
import { requestOtpSchema, verifyOtpSchema } from './auth.validators.js';

const router = Router();

router.post('/otp', validate(requestOtpSchema), asyncHandler(controller.requestOtp));
router.post('/otp/verify', validate(verifyOtpSchema), asyncHandler(controller.verifyOtp));
router.post('/logout', asyncHandler(controller.logout));

export default router;
