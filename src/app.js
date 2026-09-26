/**
 * Express application: middleware, API and the static front end.
 *
 *  - `createApp()` builds a fresh app (used by tests).
 *  - The default export is a ready-built app. src/server.js listens on it
 *    for `npm start` / `npm run dev`; serverless platforms such as Vercel
 *    import this module and use the default export directly (no listen).
 */
import path from 'node:path';
import express from 'express';
import cookieParser from 'cookie-parser';
import config from './config/index.js';
import { getSecrets } from './config/secrets.js';
import { assertSafeConfig } from './config/guards.js';
import { securityHeaders } from './middleware/security.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import apiRoutes from './routes.js';
import configRoutes from './modules/config/config.routes.js';
import { requirePageSession } from './modules/auth/auth.middleware.js';

const PUBLIC_DIR = path.resolve(process.cwd(), 'public');

export async function createApp() {
  // Refuse unsafe setups (e.g. STUB_ON in production) however we're started.
  assertSafeConfig();

  const app = express();

  // Behind a load balancer / reverse proxy, trust X-Forwarded-* so rate
  // limiting sees the real client IP and secure cookies work.
  app.set('trust proxy', config.app.trustProxy);
  app.disable('x-powered-by');

  app.use(securityHeaders);
  app.use(express.json({ limit: '10kb' }));
  app.use(cookieParser(getSecrets().COOKIE_SECRET));

  // --- API --------------------------------------------------------------
  app.use(config.api.basePath, apiRoutes);
  app.use(config.api.basePath, notFoundHandler); // unknown /v1/* → JSON 404

  // --- Sandbox tools (local testing only; never loaded in supabase mode) ----
  if (config.isSandbox) {
    const { default: sandboxRoutes } = await import('./sandbox/sandbox.routes.js');
    app.use(sandboxRoutes);
  }

  // --- Front end ----------------------------------------------------------
  app.use(configRoutes); // GET /app-config.json
  // Signed-in pages: route name → HTML file. Each is served at its configurable
  // path (config.routes) only with a valid session; they share the login session
  // automatically (the httpOnly cookie goes with every same-origin request).
  const PROTECTED_PAGES = { dashboard: 'dashboard.html', transactions: 'transactions.html' };

  // Always go through the session-checked routes, never the raw files.
  for (const [name, file] of Object.entries(PROTECTED_PAGES)) {
    app.get(`/${file}`, (_req, res) => res.redirect(config.routes[name]));
  }
  app.use(express.static(PUBLIC_DIR, { index: false, maxAge: config.isProduction ? '1h' : 0 }));

  // Page landed on from the verification email.
  app.get(config.routes.verified, (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'verified.html')));

  for (const [name, file] of Object.entries(PROTECTED_PAGES)) {
    app.get(config.routes[name], requirePageSession, (_req, res) => {
      res.set('Cache-Control', 'no-store'); // per-user page: never cache
      res.sendFile(path.join(PUBLIC_DIR, file));
    });
  }

  // Registration / sign-in single-page app: every route serves the same shell;
  // the client-side router picks the view. Unknown paths redirect to registration.
  const appRoutes = Object.entries(config.routes)
    .filter(([name]) => name !== 'verified' && !(name in PROTECTED_PAGES))
    .map(([, route]) => route);
  app.get(['/', ...appRoutes], (req, res) => {
    if (req.path === '/') return res.redirect(config.routes.register);
    return res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
  });

  app.use(errorHandler);
  return app;
}

// Ready-built app for src/server.js and serverless platforms (Vercel).
const app = await createApp();
export default app;
