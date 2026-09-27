/**
 * GET /app-config.json — the non-secret settings the browser needs (API base
 * path, routes, timings, links). The front end reads everything from here
 * instead of hard-coding values, so config/*.json stays the single source of
 * truth. Served at a fixed path (outside /v1) so the browser can find it
 * before it knows the API base path.
 */
import { Router } from 'express';
import config from '../../config/index.js';

const router = Router();

const publicConfig = Object.freeze({
  appName: config.app.name,
  // When true the UI shows a link to the /sandbox inspector (mock inbox).
  sandbox: config.isSandbox,
  apiBasePath: config.api.basePath,
  routes: config.routes,
  links: config.links,
  finance: config.finance,
  dashboard: { chartMonths: config.dashboard.chartMonths, addTransactionLinks: config.dashboard.addTransactionLinks },
  transactions: config.transactions,
  ui: config.ui,
  registration: {
    pollIntervalSec: config.registration.pollIntervalSec,
    pollTimeoutMin: config.registration.pollTimeoutMin,
    resendCooldownSec: config.registration.resendCooldownSec,
    linkTtlHours: config.registration.linkTtlHours,
  },
  otp: {
    length: config.otp.length,
    ttlSec: config.otp.ttlSec,
    maxAttempts: config.otp.maxAttempts,
    resendCooldownSec: config.otp.resendCooldownSec,
  },
});

router.get('/app-config.json', (_req, res) => {
  // no-cache: tiny file, and flags like STUB_ON must take effect on the next page load.
  res.set('Cache-Control', 'no-cache').json(publicConfig);
});

export default router;
