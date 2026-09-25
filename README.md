# MoneMapa — Registration & OTP Sign-in Module

Passwordless registration and sign-in built with **Node.js (Express)**, **Supabase Auth + Postgres**, and a
responsive **vanilla HTML/CSS/JS** front end (desktop sidebar layout, mobile progress-bar layout). Implements
the *Registration Module v2* design.

## What it does

| # | Flow | How |
|---|------|-----|
| 1 | User enters **name + email** and accepts terms | `POST /v1/registrations` |
| 2 | **Duplicate check** → 409 if the email already has an account; otherwise Supabase emails a **verification link** | `profiles` lookup + `auth.admin.inviteUserByEmail` |
| 3 | Browser **polls** verification status (countdown, resend with cooldown, pauses after 30 min, re-checks on tab focus). When verified → **welcome page with confetti** → **Go to dashboard** | `GET /v1/registrations/:id/status` |
| 4 | On verification the user is **saved in the database** (`public.profiles`) and signed in | server-side, exactly once |
| 5 | Returning users sign in with a **6-digit one-time code** emailed to them (5-min expiry, 5 attempts, resend cooldown, paste/autofill support) | `POST /v1/auth/otp`, `POST /v1/auth/otp/verify` |

```
Register ──► Check inbox (polling) ──► Welcome 🎉 ──► Dashboard
                                                         │ sign out
Sign in (email) ──► Enter code ──────────────────────────┘
```

## Tech stack

- **Node.js 20+**, Express 4, ES modules
- **Supabase**: Auth (sends emails, generates and validates codes, issues sessions) + Postgres (app tables)
- **zod** request validation · **helmet** security headers and CSP · **express-rate-limit**
- Front end: no framework and no build step. Native ES modules, History-API router, CSS custom-property design tokens

## Project structure

```
config/                      Non-secret settings (URLs, routes, timings, limits)
  default.json               shared defaults
  development.json           overrides when NODE_ENV=development
  production.json            overrides when NODE_ENV=production
  sandbox.json               overrides in sandbox mode
secrets/
  .env.example               template: copy to secrets/.env (git-ignored)
supabase/migrations/
  001_registration_module.sql  tables, RLS, atomic OTP-attempt function
src/
  server.js                  entry: validate secrets, start, graceful shutdown
  app.js                     Express app: middleware, API, static front end
  routes.js                  mounts modules under /v1
  config/                    config loader + validated secrets loader
  sandbox.js                 `npm run sandbox` entry point
  sandbox/                   local sandbox: in-memory Supabase stand-in + /sandbox inspector
  lib/                       supabase clients, errors, logger, crypto, db helper
  middleware/                validation, security (CSP, rate limit, CSRF), errors
  modules/
    registration/            routes → controller → service → repository
    auth/                    OTP sign-in, session cookies, requireAuth guard
    users/                   profiles repository, GET /v1/me
    config/                  GET /app-config.json (public settings for the browser)
public/
  index.html                 app shell (header, step sidebar, main column)
  verified.html              landing page for the email verification link
  css/                       tokens · base · layout (responsive) · components
  js/
    app.js                   bootstrap + view lifecycle
    core/                    config, api client, router, store, DOM helpers
    services/                registration/auth API clients, verificationPoller
    components/              stepper, OTP input, alerts, buttons, confetti
    views/                   register · verify · welcome · login · otp · dashboard
test/                        node:test unit tests
```

Each backend module follows **routes → controller → service → repository**:
- routes declare endpoints and validation
- controllers handle HTTP and cookies
- services hold the business rules
- repositories hold the queries

## Quick start: local sandbox (no Supabase needed)

```bash
npm install
npm run sandbox
```

- App: <http://localhost:3000/register>
- Inspector: <http://localhost:3000/sandbox>. It has a **mock inbox** (open verification links, copy sign-in
  codes), live **database tables** (`profiles`, `registrations`, `otp_challenges`) and an **event log**. Emails are also
  printed in the terminal.
- `ada@example.com` is pre-registered, so you can try the "already registered" path.
- Data is kept in `.sandbox/state.json` (git-ignored), so it survives the auto-restarts. **Reset data** on the
  inspector wipes it.

How it works: sandbox mode (`APP_MODE=sandbox`) swaps only the Supabase client (`src/lib/supabase.js`) for an
in-memory stand-in (`src/sandbox/`). Every route, service and repository is the same code that runs in production.
No secrets are required. Resend cooldowns are shortened to 15s (`config/sandbox.json`). The server refuses to start
in sandbox mode when `NODE_ENV=production`, and the `/sandbox` routes are never loaded in Supabase mode.

`npm test` runs the whole flow end to end against the sandbox over HTTP: register, click the link, auto sign-in,
sign out, then code sign-in, the attempt lockout and the cooldowns.

When the sandbox flow looks right, set up Supabase below and switch to `npm run dev`. That's the deployable mode.

## Setup (real Supabase)

### 1. Supabase project

1. Create a project at [supabase.com](https://supabase.com).
2. **SQL Editor** → run [`supabase/migrations/001_registration_module.sql`](supabase/migrations/001_registration_module.sql).
3. **Authentication → URL Configuration**
   - *Site URL*: `http://localhost:3000` (your `app.baseUrl`)
   - *Redirect URLs*: add `http://localhost:3000/verified` (plus your production URL later)
4. **Authentication → Sign In / Providers → Email**: keep *Email* enabled. Set:
   - *Email OTP Length* = `6` (must match `otp.length` in config)
   - *Email OTP Expiration*: at least `300` seconds (must be ≥ `otp.ttlSec`)
5. **Authentication → Email Templates**
   - **Invite user**: this is the verification email. Suggested subject: `Verify your email address`. The body must contain `{{ .ConfirmationURL }}`, e.g.
     ```html
     <h2>Confirm your email</h2>
     <p>Click to verify your email and finish creating your MoneMapa account:</p>
     <p><a href="{{ .ConfirmationURL }}">Verify email</a></p>
     ```
   - **Magic Link**: this is the sign-in code email. **It must include `{{ .Token }}`** (the default template only has a link). E.g. subject `Your sign-in code`, body
     ```html
     <h2>Your sign-in code</h2>
     <p>Enter this code to sign in: <strong style="font-size:24px;letter-spacing:4px">{{ .Token }}</strong></p>
     <p>It expires in 5 minutes. If you didn't request it, ignore this email.</p>
     ```
6. **Authentication → SMTP Settings**: set up a custom SMTP provider (Resend, SendGrid, Brevo, SES…).
   Supabase's built-in mailer is for testing only. It sends to your project's team members and is limited to a few emails per hour.

### 2. Secrets

```bash
cp secrets/.env.example secrets/.env
```

Fill in `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (from *Project Settings → API*) and a random
`COOKIE_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

The server validates every secret at startup and exits with a clear message if one is missing. In production, set
them as environment variables instead (they override the file). `SECRETS_FILE` can point to another file.

### 3. Run

```bash
npm install
npm run sandbox    # local sandbox, no Supabase needed
npm run dev        # real Supabase, auto-restarts on change; http://localhost:3000
npm test           # unit + end-to-end (sandbox) tests
npm start          # production-style start (set NODE_ENV=production)
```

**Troubleshooting:** `Invalid or missing secrets … still has its placeholder value` means `secrets/.env` still has
template values. Paste your project's URL and keys from *Project Settings → API*, or use `npm run sandbox` until
you have them.

## Configuration

All URLs, routes and timings live in `config/*.json`. The browser reads the public part from `/app-config.json`, so
nothing is hard-coded in the front end.

| Key | Default | Meaning |
|-----|---------|---------|
| `app.mode` | `supabase` | `supabase` or `sandbox`. Env override: `APP_MODE` (`npm run sandbox` sets it) |
| `app.baseUrl` | `http://localhost:3000` | Public URL; used for the email-link redirect. Env override: `APP_BASE_URL` |
| `app.port` | `3000` | Env override: `PORT` |
| `app.trustProxy` | `false` (`true` in prod) | Trust `X-Forwarded-*` behind a load balancer |
| `api.basePath` | `/v1` | API prefix |
| `routes.*` | `/register`, `/verify`, `/welcome`, `/login`, `/login/code`, `/dashboard`, `/verified` | Page URLs |
| `links.termsUrl` / `privacyUrl` | `/legal/*.html` | Linked from the registration form |
| `registration.linkTtlHours` | `24` | How long a pending registration stays valid |
| `registration.pollIntervalSec` | `3` | Status check interval |
| `registration.pollTimeoutMin` | `30` | Stop auto-polling after this long |
| `registration.resendCooldownSec` | `60` | Min gap between verification emails |
| `otp.length` | `6` | Digits per code (match Supabase setting) |
| `otp.ttlSec` | `300` | Code validity enforced by the app |
| `otp.maxAttempts` | `5` | Wrong guesses allowed per code |
| `otp.resendCooldownSec` | `60` | Min gap between codes |
| `session.cookiePrefix` | `mm` | Cookie name prefix |
| `session.refreshTtlDays` | `30` | Refresh-token cookie lifetime |
| `rateLimit.windowMin` / `maxRequests` | `15` / `60` | Per-IP limit on auth endpoints |

## API

All errors use the same shape: `{ "error": { "code": "EMAIL_EXISTS", "message": "…", ...details } }`.

| Endpoint | Purpose | Responses |
|----------|---------|-----------|
| `POST /v1/registrations` `{ name, email, termsAccepted }` | Start registration, email link | `202 PENDING` · `409 EMAIL_EXISTS` · `422 INVALID` · `429 RATE_LIMITED` |
| `GET /v1/registrations/:id/status` | Polled by the verify page | `200 PENDING \| VERIFIED \| EXPIRED` · `404` |
| `POST /v1/registrations/:id/resend` | New link (old one stops working) | `202` · `429 RATE_LIMITED` |
| `POST /v1/auth/otp` `{ email }` | Email a sign-in code | `200 OTP_SENT` · `404 ACCOUNT_NOT_FOUND` · `403 EMAIL_NOT_VERIFIED` · `429` |
| `POST /v1/auth/otp/verify` `{ challengeId, code }` | Check code, start session | `200 AUTHENTICATED` · `401 OTP_INVALID` · `410 OTP_EXPIRED` · `429 OTP_LOCKED` |
| `POST /v1/auth/logout` | End session | `204` |
| `GET /v1/me` | Current user + session | `200` · `401 UNAUTHENTICATED` |
| `GET /v1/health` | Liveness | `200` |

## Security notes

- **Secrets never reach the browser.** The service-role key is server-only. Supabase tokens live in `httpOnly`,
  `SameSite=Lax` cookies (`Secure` in production).
- **RLS on all tables with no policies**, so only the server can read or write them.
- **Polling is tied to the registering browser.** A random secret in an `httpOnly` cookie is required. Only its SHA-256
  hash is stored. The auto sign-in after verification is issued exactly once, using an atomic DB claim.
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
- **Branding**: colours, radii and fonts are CSS variables in `public/css/tokens.css`.
