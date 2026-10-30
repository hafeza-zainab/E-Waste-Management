# Security notes

ReLoop is a **sandbox hackathon demo**. It uses the PayPal sandbox only (the API host is hard-coded), moves no real money and its accounts are a sandbox feature (throwaway passwords, data that resets on redeploy). This file lists what is protected, what is not, and how to report a problem.

## What is enforced in code

- **Payments:** the amount is always read from the database, never the browser. Orders for agent-built jobs need the user's single-use approval token (bound to job, total and line items, 15 minutes). Capture happens once, only after the owner confirms. Payout only follows a stored capture, with a deterministic `sender_batch_id`.
- **Simulated paths are tagged SIMULATED and are unreachable in production:** the simulated buyer approval is refused when `NODE_ENV=production` (and the startup self-check force-disables the flag and logs it).
- **Input:** every API body is validated with zod, text fields have maximum lengths, request bodies are size-capped, uploads are content-sniffed (JPEG/PNG/WebP), limited to 4 MB and saved under random names.
- **Abuse and cost:** in-memory rate limits per IP and per session cookie on every public POST, plus a global daily cap on live Claude calls (`AI_DAILY_CALL_CAP`, default 200) after which the app falls back to scripted demo mode.
- **Headers:** CSP (allows only this origin and PayPal), `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options: DENY` and `frame-ancestors 'none'`, `Permissions-Policy`. Cookies are `httpOnly`, `sameSite=lax` and `secure` in production.
- **Secrets:** read only from the environment, never logged (the logger drops secret-looking keys and scrubs emails and long tokens). `.env*` (except `.env.example`), `*.db` and `public/uploads/*` are git-ignored. A scan of the full git history found no credentials.
- **Public pages** do not show emails, PayPal payer ids or full transaction ids.

## Accounts and sessions

- **Passwords:** Node's built-in `crypto.scrypt` (N=16384, r=8, p=1, 64-byte key) with a random 16-byte salt per user; the parameters are stored in the hash string so they can be raised later. Verification is constant-time (`timingSafeEqual`); an unknown email still runs a full scrypt, so response time does not reveal whether an account exists. Length 10 to 128; a password equal to the email or name is refused. Passwords are never logged or stored in the clear.
- **Sessions:** a random 32-byte token in the cookie `reloop_session`; only its **SHA-256** is stored in the `Session` table (user, expiry, created, last seen). Cookie: `httpOnly`, `SameSite=Lax`, `Secure` in production, path `/`, 7-day sliding expiry (the database row and the cookie both slide). The session is **rotated on login and signup** (the old row is deleted, so a planted token never becomes authenticated); logout deletes the row and the cookie; `POST /api/auth/logout?all=1` ends every session of the user.
- **CSRF:** `proxy.ts` rejects any state-changing `/api/*` request whose `Origin` (or, failing that, `Referer`) host is not this app's host (or `NEXT_PUBLIC_APP_URL`). The PayPal webhook is exempt (server to server; authenticated by PayPal's signature check). Server Actions use Next.js's own Origin check.
- **Rate limits** (in memory): login 10 per 15 minutes, signup 5 per hour, guest creation 10 per hour, each per IP and per email. Errors are generic: "Email or password is incorrect." Signup *does* say when an email is taken (accepted trade-off, documented).
- **Redirects:** `?next=` accepts only same-origin relative paths (no `//host`, backslashes, control characters, or the auth and API routes).
- **Authorization:** identity always comes from the session, never from a form field or request body. Every page, route and server action that returns or changes user data resolves the acting owner or technician from the session and checks ownership: a device, diagnosis, DIY guide, job, quote, approval, payment route, agent run or uploaded photo is reachable only by its owner (and, for jobs and proof photos, the assigned technician). Others get 404 (so ids cannot be probed), anonymous requests get 401 or a redirect to login. Public pages stay public: `/`, `/impact`, `/tech/[id]`, `/donate` and its unguessable-id confirmation and certificate pages.
- **Uploads** (`/uploads/[name]`) require login and are served only to the owner of the device or job they belong to and to the assigned technician. Names stay random UUIDs; responses are `Cache-Control: private, no-store`.
- **Guests** are real users with `isGuest=true`, no usable password, and are purged (with their devices, jobs, runs and sessions) after 24 hours: whenever a guest is created and once a day.
- **Tour identity:** the guided demo never uses or modifies the visitor's session. It acts through a separate overlay cookie (`reloop_tour_role`, httpOnly, bound to the tour run id) that authorizes only records tagged with that run, and the visitor's real session cookie is neither read-modified, rotated, deleted nor replaced while a tour runs.
- **Startup self-check** logs the auth mode (never secrets) and refuses to start in production when `NEXT_PUBLIC_APP_URL` is a public `http://` URL (Secure cookies would not work) or when `DEMO_ACCOUNT_PASSWORD` is shorter than 10 characters.

**Out of scope:** email verification, password reset, MFA, account lockout beyond rate limits, "remember me" choices, session listing, guest-to-account upgrade, an admin role, and protection against a malicious proxy forging `X-Forwarded-For` (the rate limiter trusts it, like most small hosts).

## Known limits (be honest)

- **Demo accounts have a public password** (in the README) so judges can try both roles. They hold demo data only; set `DEMO_ACCOUNT_PASSWORD` to change it.
- Rate limits are per process and reset on restart; with several instances they would need a shared store.
- The CSP allows `'unsafe-inline'` scripts because Next.js needs inline bootstrap scripts; a nonce-based CSP would force dynamic rendering of every page.
- `npm audit` reports a high-severity advisory in `deepmerge-ts`, pulled in by the Prisma 6 **CLI** (`prisma`, build/migrate time only; never loaded while serving requests). The fix is a major Prisma upgrade (v7), which this project deliberately avoids (see `DECISIONS.md` 3). No other advisories.
- Uploaded files live on the server's local disk (private to their owner and assigned technician, random names). On Render's free tier they are lost on redeploy.
- Webhook signatures are verified with PayPal's verify API; without `PAYPAL_WEBHOOK_ID` all webhooks are rejected.

## Reporting

Open a GitHub issue without sensitive details, or contact the maintainers privately via the hackathon submission page.
