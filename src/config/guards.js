/**
 * Configuration safety checks, run by createApp() so they apply however the
 * app is started: `npm start` (src/server.js) or a serverless platform such
 * as Vercel, which imports src/app.js directly and never runs server.js.
 */
import config from './index.js';
import logger from '../lib/logger.js';

let warned = false;

/** Throw if the configuration is unsafe for this environment; warn (once) about risky settings. */
export function assertSafeConfig() {
  // The sandbox fakes the database and email — it must never serve real users.
  if (config.isSandbox && config.isProduction) {
    throw new Error('Refusing to start: sandbox mode is not allowed when NODE_ENV=production.');
  }

  // Stub mode is allowed everywhere (temporarily needed in production while the
  // email server is unavailable), but it signs anyone in with a fixed code, so
  // make it impossible to miss.
  if (config.stub.enabled && !warned) {
    warned = true;
    const message =
      `[stub] STUB_ON=true: no emails are sent; registrations auto-verify after ${config.stub.autoVerifyAfterSec}s; ` +
      `sign-in code is always ${config.stub.otpCode}. Set STUB_ON=false for live email.`;
    if (config.isProduction) logger.error(`${message} WARNING: anyone can sign in to any account while this is on.`);
    else logger.warn(message);
  }
}
