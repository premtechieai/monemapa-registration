/**
 * Supabase connection check — `npm run check`.
 *
 * Verifies, without sending any email or creating any data:
 *   1. secrets/.env is complete (no placeholders)
 *   2. the Supabase project is reachable and the anon key is accepted
 *   3. the two keys are the right way round (anon vs service_role)
 *   4. the service_role key can use the Auth admin API
 *   5. the migration has been run (tables + spend_otp_attempt function)
 *   6. Row Level Security keeps the tables private from the anon key
 *   7. the Email sign-in provider is enabled
 * Then lists the dashboard settings that can only be checked by hand.
 *
 * Secrets are never printed. Exits with code 1 if any check fails.
 */

// Always check the real Supabase setup, even if APP_MODE is set elsewhere.
process.env.APP_MODE = 'supabase';

const { default: config } = await import('../src/config/index.js');
const { loadSecrets } = await import('../src/config/secrets.js');
const { createClient } = await import('@supabase/supabase-js');

const results = [];
const pass = (name, detail = '') => results.push({ ok: true, name, detail });
const fail = (name, detail, fix) => results.push({ ok: false, name, detail, fix });
const warn = (name, detail) => results.push({ ok: 'warn', name, detail });

/** Report a key's role from its format. Legacy keys are JWTs with a `role` claim. */
function keyRole(key) {
  if (key.startsWith('sb_publishable_')) return 'anon';
  if (key.startsWith('sb_secret_')) return 'service_role';
  try {
    return JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

async function run() {
  // 1. Secrets ----------------------------------------------------------------
  let secrets;
  try {
    secrets = loadSecrets({ sandbox: false });
    pass('Secrets file', 'all 4 values present, no placeholders');
  } catch (err) {
    fail('Secrets file', err.message.split('\n').slice(1, -2).join('; ').trim(), 'Fill in secrets/.env');
    return; // nothing else can run
  }

  const url = secrets.SUPABASE_URL.replace(/\/$/, '');
  const serverAuth = { persistSession: false, autoRefreshToken: false };
  const service = createClient(url, secrets.SUPABASE_SERVICE_ROLE_KEY, { auth: serverAuth });
  const anon = createClient(url, secrets.SUPABASE_ANON_KEY, { auth: serverAuth });

  // 2. Reachability + anon key -----------------------------------------------------
  try {
    const res = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: secrets.SUPABASE_ANON_KEY } });
    if (res.status === 401 || res.status === 403) {
      fail('Anon key', `Supabase rejected the key (HTTP ${res.status})`, 'Copy the anon/publishable key again from Project Settings > API Keys');
    } else if (!res.ok) {
      fail('Project reachable', `HTTP ${res.status} from ${url}`, 'Check SUPABASE_URL (Project Settings > Data API > Project URL)');
    } else {
      pass('Project reachable', url);
      const settings = await res.json();
      // 7. Email provider
      if (settings.external?.email) pass('Email provider enabled');
      else fail('Email provider enabled', 'Email sign-in is disabled', 'Authentication > Sign In / Providers > enable Email');
      if (settings.mailer_autoconfirm) {
        warn('Confirm email', '"Confirm email" is OFF; invite links still verify, but consider turning it on');
      }
    }
  } catch (err) {
    fail('Project reachable', `network error: ${err.cause?.code ?? err.message}`, 'Check SUPABASE_URL and your internet connection');
    return;
  }

  // 3. Keys the right way round ----------------------------------------------------
  const anonRole = keyRole(secrets.SUPABASE_ANON_KEY);
  const serviceRole = keyRole(secrets.SUPABASE_SERVICE_ROLE_KEY);
  if (anonRole === 'service_role') {
    fail('Key roles', 'SUPABASE_ANON_KEY holds the service_role key', 'Swap the two keys in secrets/.env');
  } else if (serviceRole === 'anon') {
    fail('Key roles', 'SUPABASE_SERVICE_ROLE_KEY holds the anon key', 'Use the service_role/secret key');
  } else {
    pass('Key roles', `anon=${anonRole}, service=${serviceRole}`);
  }

  // 4. Service role → Auth admin API ---------------------------------------------------
  const { error: adminError } = await service.auth.admin.listUsers({ page: 1, perPage: 1 });
  if (adminError) {
    fail('Auth admin API', `${adminError.status ?? ''} ${adminError.message}`.trim(), 'SUPABASE_SERVICE_ROLE_KEY must be the service_role/secret key');
  } else {
    pass('Auth admin API', 'service_role key accepted');
  }

  // 5. Migration: tables and function -----------------------------------------------------
  let tablesOk = true;
  for (const table of ['profiles', 'registrations', 'otp_challenges']) {
    const { error, count } = await service.from(table).select('*', { count: 'exact', head: true });
    if (error) {
      tablesOk = false;
      const missing = ['42P01', 'PGRST205'].includes(error.code) || /does not exist|schema cache/i.test(error.message);
      fail(`Table ${table}`, missing ? 'not found' : error.message, 'Run supabase/migrations/001_registration_module.sql in the SQL Editor');
    } else {
      pass(`Table ${table}`, `${count ?? 0} rows`);
    }
  }

  const { data: spent, error: rpcError } = await service.rpc('spend_otp_attempt', {
    p_challenge_id: '00000000-0000-0000-0000-000000000000',
  });
  if (rpcError) fail('Function spend_otp_attempt', rpcError.message, 'Run the migration SQL again (it is safe to re-run)');
  else if (spent !== -1) fail('Function spend_otp_attempt', `unexpected result ${spent}`, 'Re-run the migration SQL');
  else pass('Function spend_otp_attempt');

  // 6. RLS: anon must not read app tables ------------------------------------------------------
  if (tablesOk) {
    const { data, error } = await anon.from('profiles').select('id').limit(1);
    if (!error && data?.length) {
      fail('Row Level Security', 'anon key can read profiles', 'Re-run the migration (it enables RLS)');
    } else {
      pass('Row Level Security', 'tables are private to the server');
    }
  }
}

await run();

// --- Report ----------------------------------------------------------------------------------
const icon = { true: 'PASS', false: 'FAIL', warn: 'WARN' };
console.log(`\nSupabase connection check (${config.app.name})\n`);
for (const r of results) {
  console.log(`  [${icon[r.ok]}] ${r.name}${r.detail ? ` - ${r.detail}` : ''}`);
  if (r.fix) console.log(`         fix: ${r.fix}`);
}

const failed = results.filter((r) => r.ok === false).length;
console.log(`
Check these by hand in the Supabase dashboard (they can't be read via the API):
  - Authentication > URL Configuration: Site URL = ${config.app.baseUrl}
    and Redirect URLs include ${config.app.baseUrl}${config.routes.verified}
  - Authentication > Email Templates > Magic Link: body contains {{ .Token }}
  - Authentication > Email Templates > Invite user: body contains {{ .ConfirmationURL }}
  - Authentication > Sign In / Providers > Email: OTP length = ${config.otp.length}, expiry >= ${config.otp.ttlSec}s
  - Authentication > SMTP Settings: custom SMTP (built-in mailer only reaches team members)
`);
console.log(failed ? `${failed} check(s) failed.\n` : 'All automated checks passed. Next: npm run dev\n');
process.exitCode = failed ? 1 : 0;
