/**
 * Client for the registration API (src/modules/registration).
 */
import { api } from '../core/api.js';

export const registrationService = {
  /** Start registration → { registrationId, email, status, pollIntervalSec, resendAvailableInSec } */
  register: ({ name, email, termsAccepted }) => api.post('/registrations', { name, email, termsAccepted }),

  /** Poll verification → { status: 'PENDING' | 'VERIFIED' | 'EXPIRED', user? } */
  getStatus: (registrationId) => api.get(`/registrations/${encodeURIComponent(registrationId)}/status`),

  /** Email a fresh verification link → { resendAvailableInSec, ... } */
  resend: (registrationId) => api.post(`/registrations/${encodeURIComponent(registrationId)}/resend`),
};
