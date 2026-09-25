/**
 * Client for the sign-in and session APIs (src/modules/auth, src/modules/users).
 */
import { api } from '../core/api.js';

export const authService = {
  /** Email a one-time code → { challengeId, expiresAt, attemptsLeft, otpLength, resendAvailableInSec } */
  requestOtp: (email) => api.post('/auth/otp', { email }),

  /** Check the code → { user, session }. Sets the session cookies on success. */
  verifyOtp: (challengeId, code) => api.post('/auth/otp/verify', { challengeId, code }),

  /** Current user → { user, session }. Throws ApiError 401 when signed out. */
  me: () => api.get('/me'),

  logout: () => api.post('/auth/logout'),
};
