/**
 * Entry point: validate secrets, build the app, start listening, and shut
 * down cleanly on SIGINT/SIGTERM (Ctrl+C, Docker stop, etc.).
 */
import config from './config/index.js';
import { getSecrets } from './config/secrets.js';
import logger from './lib/logger.js';

/**
 * Report a startup problem and let Node exit on its own with code 1.
 * (Calling process.exit() right after writing can cut the message short on
 * Windows, where stderr to a pipe is asynchronous.)
 */
function failStartup(message) {
  logger.error(message);
  process.exitCode = 1;
}

async function main() {
  // The sandbox fakes auth and email — it must never serve real users.
  if (config.isSandbox && config.isProduction) {
    return failStartup('Refusing to start: sandbox mode is not allowed when NODE_ENV=production.');
  }
  // Stub mode signs anyone in with a fixed code — never on a real deployment.
  if (config.stub.enabled && config.isProduction) {
    return failStartup('Refusing to start: STUB_ON=true is not allowed when NODE_ENV=production.');
  }
  if (config.stub.enabled) {
    logger.warn(
      `[stub] STUB_ON=true: no emails are sent; registrations auto-verify after ${config.stub.autoVerifyAfterSec}s; ` +
        `sign-in code is always ${config.stub.otpCode}. Set STUB_ON=false for live email.`,
    );
  }

  // Validate secrets before anything else so misconfiguration fails loudly.
  try {
    getSecrets();
  } catch (err) {
    return failStartup(err.message);
  }

  // Imported after the checks: loading the app creates the Supabase clients.
  const { createApp } = await import('./app.js');
  const app = await createApp();

  const server = app.listen(config.app.port, () => {
    logger.info(`${config.app.name} registration module running`, {
      url: config.app.baseUrl,
      env: config.env,
      mode: config.app.mode,
    });
    if (config.isSandbox) {
      logger.info(`[sandbox] App:       ${config.app.baseUrl}${config.routes.register}`);
      logger.info(`[sandbox] Inspector: ${config.app.baseUrl}/sandbox  (mock inbox, database, event log)`);
    }
  });

  function shutdown(signal) {
    logger.info(`${signal} received, shutting down`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref(); // force-exit if connections hang
  }

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => failStartup(err.stack ?? err.message));
