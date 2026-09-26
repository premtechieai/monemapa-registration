# MoneMapa — Registration & OTP Sign-in Module

Passwordless registration and sign-in built with **Node.js (Express)**, **Supabase Postgres**, **SMTP email sent
directly from Node (Nodemailer)**, and a responsive **vanilla HTML/CSS/JS** front end (desktop sidebar layout,
mobile progress-bar layout). Implements the *Registration Module v2* design.

## What it does

| # | Flow | How |
|---|------|-----|
| 1 | User enters **name + email** and accepts terms | `POST /v1/registrations` |
| 2 | **Duplicate check** → 409 if the email already has an account; otherwise the app emails an **activation link** over SMTP | `profiles` lookup + `sendVerificationEmail` |
| 3 | Browser **polls** verification status (countdown, resend with cooldown, pauses after 30 min, re-checks on tab focus). When verified → **welcome page with confetti** → **Go to dashboard** | `GET /v1/registrations/:id/status` |
| 4 | Opening the link **saves the user in the database** (`public.profiles`); the registering browser is signed in exactly once | `POST /v1/verifications` |
| 5 | Returning users sign in with a **6-digit one-time code** emailed over SMTP (5-min expiry, 5 attempts, resend cooldown, paste/autofill support) | `POST /v1/auth/otp`, `POST /v1/auth/otp/verify` |

```
Register ──► Check inbox (polling) ──► Welcome 🎉 ──► Dashboard
                                                         │ sign out
Sign in (email) ──► Enter code ──────────────────────────┘
```

## Tech stack

- **Node.js 22.15+**, Express 4, ES modules
- **Supabase**: used only as the **Postgres database** (service-role key, server-side). Supabase Auth is not used.
- **Nodemailer** → your SMTP provider (Resend, Gmail, Brevo, SendGrid, SES…) for both emails
- **zod** request validation · **helmet** security headers and CSP · **express-rate-limit**
- Front end: no framework and no build step. Native ES modules, History-API router, CSS custom-property design tokens

## Project structure

```
config/                      Non-secret settings (URLs, routes, timings, limits, SMTP server, sender, subjects)
  default.json               shared defaults
  development.json           overrides when NODE_ENV=development
  production.json            overrides when NODE_ENV=production
  sandbox.json               overrides in sandbox mode
secrets/
  .env.example               template: copy to secrets/.env (git-ignored)
supabase/migrations/
  001_registration_module.sql  tables, RLS, atomic OTP-attempt function
  002_app_managed_auth.sql     own tokens, code hashes and sessions (no Supabase Auth)
scripts/
  check-connection.js        `npm run check`: database + SMTP connection test
src/
  server.js                  entry: validate secrets, start, graceful shutdown
  app.js                     Express app: middleware, API, static front end
  routes.js                  mounts modules under /v1
  config/                    config loader + validated secrets loader
  sandbox.js                 `npm run sandbox` entry point
  sandbox/                   local sandbox: in-memory database + mock inbox + /sandbox inspector
  lib/                       database client, errors, logger, crypto, db helper
  middleware/                validation, security (CSP, rate limit, CSRF), errors
  modules/
    registration/            routes → controller → service → repository
    auth/                    OTP sign-in, server-side sessions, requireAuth guard
    email/                   EmailService, SMTP mailer, template renderer
      templates/             verify-email.html/.txt · sign-in-code.html/.txt
    users/                   profiles repository, GET /v1/me
    config/                  GET /app-config.json (public settings for the browser)
public/
  index.html                 app shell (header, step sidebar, main column)
  verified.html              landing page for the activation link
  css/                       tokens · base · layout (responsive) · components
  js/
    app.js                   bootstrap + view lifecycle
    core/                    config, api client, router, store, DOM helpers
    services/                registration/auth API clients, verificationPoller
    components/              stepper, OTP input, alerts, buttons, confetti
    views/                   register · verify · welcome · login · otp · dashboard
test/                        node:test unit + end-to-end tests
```

Each backend module follows **routes → controller → service → repository**:
- routes declare endpoints and validation
- controllers handle HTTP and cookies
- services hold the business rules
- repositories hold the queries

## Quick start: local sandbox (no database or SMTP needed)

```bash
npm install
npm run sandbox
```

- App: <http://localhost:3000/register>
- Inspector: <http://localhost:3000/sandbox>. It has a **mock inbox** (open activation links, copy sign-in codes,
  **View email** to see the real rendered template), live **database tables** (`profiles`, `registrations`,
  `otp_challenges`, `sessions`) and an **event log**. Emails are also printed in the terminal.
- `ada@example.com` is pre-registered, so you can try the "already registered" path.
- Data is kept in `.sandbox/state.json` (git-ignored), so it survives the auto-restarts. **Reset data** on the
  inspector wipes it.

How it works: sandbox mode (`APP_MODE=sandbox`) swaps only the database client for an in-memory stand-in and the
SMTP transport for the mock inbox. Every route, service, repository and email template is the same code that runs
in production. No secrets are required. Resend cooldowns are shortened to 15s (`config/sandbox.json`). The server
refuses to start in sandbox mode when `NODE_ENV=production`, and the `/sandbox` routes are never loaded otherwise.

`npm test` runs the whole flow end to end against the sandbox over HTTP (register, open the link, auto sign-in,
sign out, code sign-in, attempt lockout, cooldowns, link replacement) and checks the rendered emails.

## Setup (real database + SMTP)

### 1. Database (Supabase)

1. Create a project at [supabase.com](https://supabase.com).
2. **SQL Editor** → run, in order:
   - [`supabase/migrations/001_registration_module.sql`](supabase/migrations/001_registration_module.sql)
   - [`supabase/migrations/002_app_managed_auth.sql`](supabase/migrations/002_app_managed_auth.sql)

   Both are safe to re-run. No Supabase Auth settings (URL configuration, email templates, OTP length, SMTP) are
   needed: the app does all of that itself.

### 2. SMTP provider

Any SMTP provider works. Server settings go in `config/default.json` → `email.smtp`; the login goes in secrets.

| Provider | `email.smtp` | `SMTP_USER` / `SMTP_PASSWORD` | Sender (`email.from.address`) |
|---|---|---|---|
| **Resend** (default) | `smtp.resend.com`, port `587`, `secure: false` | `resend` / your API key (`re_…`) | An address on a domain verified in Resend. `…@resend.dev` only delivers to your own Resend account email |
| Gmail | `smtp.gmail.com`, port `587`, `secure: false` | your Gmail / a 16-char **app password** | your Gmail address |
| Brevo | `smtp-relay.brevo.com`, port `587`, `secure: false` | Brevo SMTP login / SMTP key | a verified sender |

Port `587` with `secure: false` uses STARTTLS; the app always requires TLS before sending the login. It's the
default because antivirus "Mail Shield" features (e.g. Norton) intercept port `465` with a certificate they
deliberately mark untrusted. Resend also offers `2465` (TLS) and `2587` (STARTTLS).

### 3. Secrets

```bash
cp secrets/.env.example secrets/.env
```

Fill in `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (*Project Settings → API*), `SMTP_USER` / `SMTP_PASSWORD`,
and a random `COOKIE_SECRET` (it signs cookies and keys the one-time-code hashes):

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

The server validates every secret at startup and exits with a clear message if one is missing. In production, set
them as environment variables instead (they override the file). `SECRETS_FILE` can point to another file.

### 4. Check, then run

```bash
npm run check                                   # database + SMTP login, sends nothing
npm run check -- --send-test=you@example.com    # also sends a real test email
npm run dev                                     # auto-restarts on change; http://localhost:3000
npm test                                        # unit + end-to-end (sandbox) tests
npm start                                       # production-style start (set NODE_ENV=production)
```

**Troubleshooting: `fetch failed` / `unable to verify the first certificate` / `UNABLE_TO_VERIFY_LEAF_SIGNATURE`.**
Antivirus HTTPS/email scanning (for example Norton Web/Mail Shield) or a corporate proxy is re-signing TLS traffic.
The npm scripts start Node with `--use-system-ca` (Node 22.15+), so Node trusts the Windows certificate store the
same way browsers do; always start the app through `npm run …`. If email still fails, the scanner is using an
*untrusted* certificate for that port: use SMTP port `587` (the default), or exclude `node.exe` from the scan.

Never work around it with `NODE_TLS_REJECT_UNAUTHORIZED=0`, which turns off certificate checking entirely.

**Troubleshooting: `EMAIL_SEND_FAILED` / "We couldn't send the email".** The server log line `Email send failed`
contains the SMTP server's reply (`response`). Common causes: wrong `SMTP_USER`/`SMTP_PASSWORD` (`EAUTH`), a sender
address your provider hasn't verified, or a blocked port (try `587` with `secure: false`). `npm run check` tests the
login.

**Troubleshooting:** `Invalid or missing secrets … still has its placeholder value` means `secrets/.env` still has
template values. Fill them in, or use `npm run sandbox` until you have them.

## Email templates

The two emails live in the app, in `src/modules/email/templates/`, each as HTML plus a plain-text fallback:

| Template | Sent when | Placeholders |
|---|---|---|
| `verify-email.html` / `.txt` | After registration: account activation link | `appName`, `name`, `email`, `link`, `linkTtlHours` |
| `sign-in-code.html` / `.txt` | Every sign-in: one-time code, **no link** | `appName`, `email`, `code`, `codeTtlMinutes` |

Placeholders use `{{ name }}` and are HTML-escaped in the `.html` version. Subjects are in `config` →
`email.subjects`. Outside production, templates are re-read on each send, so edits show up immediately; preview them
with **View email** on the sandbox inspector.

## Configuration

All URLs, routes, timings and email settings live in `config/*.json`. The browser reads the public part from
`/app-config.json`, so nothing is hard-coded in the front end.

| Key | Default | Meaning |
|-----|---------|---------|
| `app.mode` | `supabase` | `supabase` or `sandbox`. Env override: `APP_MODE` (`npm run sandbox` sets it) |
| `app.baseUrl` | `http://localhost:3000` | Public URL; used to build the activation link. Env override: `APP_BASE_URL` |
| `app.port` | `3000` | Env override: `PORT` |
| `app.trustProxy` | `false` (`true` in prod) | Trust `X-Forwarded-*` behind a load balancer |
| `api.basePath` | `/v1` | API prefix |
| `routes.*` | `/register`, `/verify`, `/welcome`, `/login`, `/login/code`, `/dashboard`, `/verified` | Page URLs |
| `links.termsUrl` / `privacyUrl` | `/legal/*.html` | Linked from the registration form |
| `registration.linkTtlHours` | `24` | How long an activation link stays valid |
| `registration.pollIntervalSec` | `3` | Status check interval |
| `registration.pollTimeoutMin` | `30` | Stop auto-polling after this long |
| `registration.resendCooldownSec` | `60` | Min gap between activation emails |
| `otp.length` | `6` | Digits per code |
| `otp.ttlSec` | `300` | Code validity |
| `otp.maxAttempts` | `5` | Wrong guesses allowed per code |
| `otp.resendCooldownSec` | `60` | Min gap between codes |
| `session.cookiePrefix` | `mm` | Cookie name prefix |
| `session.ttlDays` | `30` | Session lifetime |
| `email.from.name` / `.address` | `MoneMapa` / `ContactHackathon@mail.outskill.com` | Sender shown to recipients |
| `email.replyTo` | empty | Optional Reply-To address |
| `email.smtp.host` / `.port` / `.secure` | `smtp.resend.com` / `587` / `false` | SMTP server |
| `email.smtp.connectionTimeoutMs` | `10000` | Give up connecting after this long |
| `email.subjects.verifyEmail` / `.signInCode` | see file | Subject lines (placeholders allowed) |
| `rateLimit.windowMin` / `maxRequests` | `15` / `60` | Per-IP limit on auth endpoints |

## API

All errors use the same shape: `{ "error": { "code": "EMAIL_EXISTS", "message": "…", ...details } }`.

| Endpoint | Purpose | Responses |
|----------|---------|-----------|
| `POST /v1/registrations` `{ name, email, termsAccepted }` | Start registration, email activation link | `202 PENDING` · `409 EMAIL_EXISTS` · `422 INVALID` · `429 RATE_LIMITED` · `502 EMAIL_SEND_FAILED` |
| `POST /v1/verifications` `{ token }` | Called by `/verified` when the link is opened | `200 VERIFIED` · `404 LINK_INVALID` · `410 LINK_EXPIRED` |
| `GET /v1/registrations/:id/status` | Polled by the verify page | `200 PENDING \| VERIFIED \| EXPIRED` · `404` |
| `POST /v1/registrations/:id/resend` | New link (old one stops working) | `202` · `429 RATE_LIMITED` · `502 EMAIL_SEND_FAILED` |
| `POST /v1/auth/otp` `{ email }` | Email a sign-in code | `200 OTP_SENT` · `404 ACCOUNT_NOT_FOUND` · `403 EMAIL_NOT_VERIFIED` · `429` · `502 EMAIL_SEND_FAILED` |
| `POST /v1/auth/otp/verify` `{ challengeId, code }` | Check code, start session | `200 AUTHENTICATED` · `401 OTP_INVALID` · `410 OTP_EXPIRED` · `429 OTP_LOCKED` |
| `POST /v1/auth/logout` | End session | `204` |
| `GET /v1/me` | Current user + session | `200` · `401 UNAUTHENTICATED` |
| `GET /v1/health` | Liveness | `200` |

## Security notes

- **Secrets never reach the browser.** The service-role key and SMTP login are server-only. The session lives in an
  `httpOnly`, `SameSite=Lax` cookie (`Secure` in production) holding a random token; only its SHA-256 hash is stored
  (`public.sessions`), and signing out revokes it.
- **Nothing sensitive is stored in plain text.** Activation-link tokens and poll secrets are stored as SHA-256 hashes;
  one-time codes as HMAC-SHA-256 keyed with `COOKIE_SECRET`, so a leaked table can't be brute-forced offline.
- **Activation links** carry the token in the URL fragment (never sent to servers or logs) and are confirmed with a
  POST from `/verified`, so email link scanners can't activate accounts by fetching the URL. Links are single-use,
  expire after `registration.linkTtlHours`, and resending replaces the previous link.
- **Sign-in emails contain no link**, so sign-in always goes through the code screen and its limits.
- **RLS on all tables with no policies**, so only the server can read or write them.
- **Polling is tied to the registering browser.** A random secret in an `httpOnly` cookie is required. The auto
  sign-in after verification is issued exactly once, using an atomic DB claim.
- **OTP brute-force cap.** Each attempt is spent atomically in Postgres *before* the code is checked, so parallel
  guesses can't exceed `otp.maxAttempts`. Requesting a new code revokes the old one.
- **CSRF**: state-changing requests must be `application/json`, and a cross-site form can't send that.
- **Strict CSP** (self + Google Fonts), per-IP rate limiting, 10 KB body limit, no `X-Powered-By`.
- **Trade-off:** as the design specifies, sign-in says whether an email is unknown or unverified. This helps users
  but allows account enumeration. Rate limiting reduces the risk. For stricter privacy, return one generic response.

## Integration points

- **Dashboard hand-off**: `public/js/views/dashboardView.js` is a placeholder that shows the signed-in user. Mount your
  real dashboard there, or change `routes.dashboard` to point elsewhere. Protect server routes with
  `requireAuth` (`src/modules/auth/auth.middleware.js`), which sets `req.user`.
- **Branding**: colours, radii and fonts are CSS variables in `public/css/tokens.css`; email styling is inline in the
  templates.
