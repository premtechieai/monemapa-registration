/**
 * Sandbox entry point: `npm run sandbox`.
 *
 * Starts the normal server with app.mode = "sandbox", so the whole flow can
 * be tested locally with no Supabase project, mail server or secrets.
 * Setting the variable here (not in package.json) keeps the npm script
 * working the same in PowerShell, cmd and bash.
 */
process.env.APP_MODE = 'sandbox';

await import('./server.js');
