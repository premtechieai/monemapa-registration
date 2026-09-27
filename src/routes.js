/**
 * API router — mounts every module under the versioned base path (/v1).
 * Adding a module = one import + one `use` line here.
 */
import { Router } from 'express';
import { apiRateLimit, requireJson } from './middleware/security.js';
import { registrationRoutes, verificationRoutes } from './modules/registration/registration.routes.js';
import authRoutes from './modules/auth/auth.routes.js';
import userRoutes from './modules/users/users.routes.js';
import transactionsRoutes from './modules/transactions/transactions.routes.js';

const api = Router();

api.use(requireJson);
api.get('/health', (_req, res) => res.json({ status: 'ok' }));
api.use('/registrations', apiRateLimit, registrationRoutes);
api.use('/verifications', apiRateLimit, verificationRoutes);
api.use('/auth', apiRateLimit, authRoutes);
api.use(userRoutes);
// Signed-in data APIs (session required; not under the strict auth rate limit,
// since category suggestions are requested while typing).
api.use(transactionsRoutes);

export default api;
