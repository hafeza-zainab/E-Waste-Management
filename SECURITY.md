# Security notes

ReLoop is a **sandbox hackathon demo**. It uses the PayPal sandbox only (the API host is hard-coded), moves no real money and has no real user accounts. This file lists what is protected, what is not, and how to report a problem.

## What is enforced in code

- **Payments:** the amount is always read from the database, never the browser. Orders for agent-built jobs need the user's single-use approval token (bound to job, total and line items, 15 minutes). Capture happens once, only after the owner confirms. Payout only follows a stored capture, with a deterministic `sender_batch_id`.
- **Simulated paths are tagged SIMULATED and are unreachable in production:** the simulated buyer approval is refused when `NODE_ENV=production` (and the startup self-check force-disables the flag and logs it).
- **Input:** every API body is validated with zod, text fields have maximum lengths, request bodies are size-capped, uploads are content-sniffed (JPEG/PNG/WebP), limited to 4 MB and saved under random names.
- **Abuse and cost:** in-memory rate limits per IP and per session cookie on every public POST, plus a global daily cap on live Claude calls (`AI_DAILY_CALL_CAP`, default 200) after which the app falls back to scripted demo mode.
- **Headers:** CSP (allows only this origin and PayPal), `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options: DENY` and `frame-ancestors 'none'`, `Permissions-Policy`. Cookies are `httpOnly`, `sameSite=lax` and `secure` in production.
- **Secrets:** read only from the environment, never logged (the logger drops secret-looking keys and scrubs emails and long tokens). `.env*` (except `.env.example`), `*.db` and `public/uploads/*` are git-ignored. A scan of the full git history found no credentials.
- **Public pages** do not show emails, PayPal payer ids or full transaction ids.

## Known limits (be honest)

- **The "login" is a role cookie.** Anyone can switch between Owner and Technician in the header. That is a demo convenience, not authentication. Do not put real data in a deployment.
- Rate limits are per process and reset on restart; with several instances they would need a shared store.
- The CSP allows `'unsafe-inline'` scripts because Next.js needs inline bootstrap scripts; a nonce-based CSP would force dynamic rendering of every page.
- `npm audit` reports a high-severity advisory in `deepmerge-ts`, pulled in by the Prisma 6 **CLI** (`prisma`, build/migrate time only; never loaded while serving requests). The fix is a major Prisma upgrade (v7), which this project deliberately avoids (see `DECISIONS.md` 3). No other advisories.
- Uploaded files live on the server's local disk and are public by URL (random names). On Render's free tier they are lost on redeploy.
- Webhook signatures are verified with PayPal's verify API; without `PAYPAL_WEBHOOK_ID` all webhooks are rejected.

## Reporting

Open a GitHub issue without sensitive details, or contact the maintainers privately via the hackathon submission page.
