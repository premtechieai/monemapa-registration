/**
 * Connection check — `npm run check` (add `-- --send-test=you@example.com`
 * to also send a real test email).
 *
 * Verifies, without creating any data:
 *   1. secrets/.env is complete (no placeholders)
 *   2. the Supabase database is reachable with the service_role key
 *   3. migrations 001 and 002 have been run (tables, columns, function)
 *   4. the SMTP server accepts a connection and the login
 *   5. optionally: an email can actually be delivered
 *
 * Secrets are never printed. Exits with code 1 if any check fails.
 */

// Always check the real setup, even if APP_MODE is set elsewhere.
process.env.APP_MODE = 'supabase';

const { default: config } = await import('../src/config/index.js');
const { loadSecrets } = await import('../src/config/secrets.js');

const sendTestTo = process.argv.find((a) => a.startsWith('--send-test='))?.split('=')[1];

const results = [];
const pass = (name, detail = '') => results.push({ ok: true, name, detail });
const fail = (name, detail, fix) => results.push({ ok: false, name, detail, fix });

/**
 * Antivirus HTTPS/email scanning or a proxy re-signs TLS with its own root
 * certificate. Accepts an error, code or message; follows `cause` (fetch wraps
 * the real TLS error as "fetch failed").
 */
function isInterceptedTls(errOrText) {
  const pattern = /UNABLE_TO_VERIFY_LEAF_SIGNATURE|SELF_SIGNED_CERT_IN_CHAIN|UNABLE_TO_GET_ISSUER_CERT|unable to verify the first certificate|self[- ]signed certificate/i;
  for (let e = errOrText; e; e = e.cause) {
    if (typeof e === 'string') return pattern.test(e);
    if (pattern.test(`${e.code ?? ''} ${e.message ?? ''}`)) return true;
  }
  return false;
}
const TLS_FIX =
  'Antivirus scanning (e.g. Norton Web/Mail Shield) or a proxy is re-signing TLS. Run via npm scripts ' +
  '(they use --use-system-ca), use SMTP port 587, or exclude node.exe from the scan. See README > Troubleshooting';

async function checkDatabase() {
  const { db } = await import('../src/lib/supabase.js');

  // Tables, plus a column added by each migration so a missing 002 is caught.
  const expectations = [
    ['profiles', 'id, email'],
    ['registrations', 'id, verification_token_hash, user_id'],
    ['otp_challenges', 'id, code_hash'],
    ['sessions', 'id, token_hash'],
    ['categories', 'id, name'],
    ['transactions', 'id, user_id, category_source'],
    ['category_rules', 'id, pattern'],
  ];

  for (const [table, columns] of expectations) {
    // limit(0) (not a HEAD request) so errors come back with a message.
    const { error, count } = await db.from(table).select(columns, { count: 'exact' }).limit(0);
    if (!error) {
      pass(`Table ${table}`, `${count ?? 0} rows`);
      continue;
    }
    const cause = error.message ?? '';
    if (/fetch failed/i.test(cause) || isInterceptedTls(error)) {
      const tls = isInterceptedTls(error) || isInterceptedTls(cause);
      const detail = error.details ? `${cause} (${error.details})` : cause;
      fail('Database reachable', detail, tls ? TLS_FIX : 'Check SUPABASE_URL, your internet connection, and whether antivirus/proxy scanning is intercepting HTTPS');
      return;
    }
    if (/invalid api key|jwt/i.test(cause)) {
      fail('Database reachable', cause, 'SUPABASE_SERVICE_ROLE_KEY must be the service_role / secret key');
      return;
    }
    const missing = ['42P01', '42703', 'PGRST204', 'PGRST205'].includes(error.code) || /does not exist|schema cache/i.test(cause);
    fail(
      `Table ${table}`,
      missing ? `missing table or columns (${cause})` : cause,
      'Run the SQL files in supabase/migrations/ (001, 002, 003) in the SQL Editor',
    );
  }

  const { data: spent, error: rpcError } = await db.rpc('spend_otp_attempt', {
    p_challenge_id: '00000000-0000-0000-0000-000000000000',
  });
  if (rpcError) fail('Function spend_otp_attempt', rpcError.message, 'Re-run migration 001 (safe to re-run)');
  else if (spent !== -1) fail('Function spend_otp_attempt', `unexpected result ${spent}`, 'Re-run migration 001');
  else pass('Function spend_otp_attempt');
}

async function checkSmtp() {
  const { mailer } = await import('../src/modules/email/mailer.js');
  const { host, port, secure } = config.email.smtp;
  const where = `${host}:${port} (${secure ? 'TLS' : 'STARTTLS'})`;

  try {
    await mailer.verify();
    pass('SMTP login', where);
  } catch (err) {
    const code = err.code ?? '';
    let fix = 'Check email.smtp host/port/secure in config/default.json';
    if (code === 'EAUTH') fix = 'SMTP_USER / SMTP_PASSWORD rejected (Resend: user "resend", password = API key)';
    else if (isInterceptedTls(err)) fix = TLS_FIX;
    else if (['ETIMEDOUT', 'ECONNECTION', 'ESOCKET'].includes(code)) {
      fix = `Could not reach ${where}. Port blocked by a firewall/ISP? Try port 587 with "secure": false`;
    }
    fail('SMTP login', `${where}: ${err.response ?? err.message}`, fix);
    return;
  }

  if (!sendTestTo) return;
  try {
    await mailer.send({
      to: sendTestTo,
      subject: `${config.app.name} SMTP test`,
      text: `This is a test email from the ${config.app.name} connection check. SMTP delivery works.`,
      html: `<p>This is a test email from the <strong>${config.app.name}</strong> connection check. SMTP delivery works.</p>`,
    });
    pass('Test email sent', `to ${sendTestTo} from ${config.email.from.address}`);
  } catch (err) {
    fail(
      'Test email sent',
      err.response ?? err.message,
      `The server refused the message: is the sender ${config.email.from.address} allowed/verified with your provider?`,
    );
  }
}

async function run() {
  try {
    loadSecrets({ sandbox: false });
    pass('Secrets file', 'all values present, no placeholders');
  } catch (err) {
    fail('Secrets file', err.message.split('\n').slice(1, -2).join('; ').trim(), 'Fill in secrets/.env (see secrets/.env.example)');
    return; // nothing else can run
  }
  await checkDatabase();
  await checkSmtp();
}

await run();

// --- Report ------------------------------------------------------------------
console.log(`\n${config.app.name} connection check\n`);
for (const r of results) {
  console.log(`  [${r.ok ? 'PASS' : 'FAIL'}] ${r.name}${r.detail ? ` - ${r.detail}` : ''}`);
  if (r.fix) console.log(`         fix: ${r.fix}`);
}

const failed = results.filter((r) => !r.ok).length;
if (!sendTestTo && !failed) console.log('\nTip: npm run check -- --send-test=you@example.com   sends a real test email.');
console.log(failed ? `\n${failed} check(s) failed.\n` : '\nAll checks passed. Next: npm run dev\n');
process.exitCode = failed ? 1 : 0;
