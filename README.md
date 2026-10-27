# ReLoop

[![License: MIT](https://img.shields.io/badge/License-MIT-teal.svg)](LICENSE)

An AI repair agent that diagnoses a broken device, decides whether a DIY fix is safe, books and pays a local technician through PayPal, and only releases the technician's payout after the repair is verified. Built for the PayPal AI Hackathon.

> Status: Phase 1 (scaffold). The full README (architecture, PayPal and AI usage, test accounts, limitations) is written in Phase 7.

## Quick start

```bash
cp .env.example .env
npm run setup   # install, generate Prisma client, migrate, seed
npm run dev     # http://localhost:3000
npm test
```

`DEMO_MODE=true` (the default) needs no API keys. PayPal is always sandbox.

## Payments: how money moves (PayPal sandbox)

1. **Authorize** at checkout (Orders v2, `intent=AUTHORIZE`): funds are held, not taken.
2. **Capture** only when the job's owner presses "Confirm repair is done" (`PayPal-Request-Id` derived from the job id, capture id stored, so it happens once).
3. **Payout** of the technician's share (default 90%, integer cents) through the Payouts API, only after a stored capture. `sender_batch_id` is derived from the job id, so a retry cannot pay twice. If it fails the job shows **Retry payout**.

Authorization timing (PayPal Payments v2): **3-day honor period**, **valid 29 days**. After day 3 the app re-authorizes before capturing; at day 29 or if PayPal reports it voided/expired the job becomes `authorization_expired` and nothing is charged. (Verify against the live PayPal docs before submission.)

Debugging checkout: `npm run paypal:check` creates test orders against the sandbox and prints the approve link, token scopes and app id (never the secret). If the SDK popup fails, the job page offers "Continue to PayPal in this tab".

### PayPal dashboard checklist

- **Buyer:** developer.paypal.com > Testing Tools > Sandbox Accounts > Create account > *Personal*, country **US**, and fund it in USD. Log in to the checkout with this account, never the Business one.
- **Payouts:** Apps & Credentials > Sandbox > your app > Features > tick **Payouts** (and Save). Then check the sandbox *Business* account has a USD balance (Sandbox Accounts > account > Funding). Without this the app records a clearly labelled *simulated* payout.
- **Real payout recipient:** seeded technician emails are not real sandbox accounts, so real payouts to them show as UNCLAIMED. For a demo set `PAYPAL_PAYOUT_RECEIVER_OVERRIDE` to a sandbox Personal account email.
- **Webhook:** add `<public url>/api/paypal/webhook` with events `PAYMENT.AUTHORIZATION.CREATED`, `PAYMENT.AUTHORIZATION.VOIDED`, `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.PAYOUTS-ITEM.*`, and put its id in `PAYPAL_WEBHOOK_ID`.

## License

MIT, see [LICENSE](LICENSE).
