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

## Donations (Refurbish & Donate Fund)

`/donate` takes presets ($5, $10, $25) or a custom amount ($1 to $500). The server validates the amount into integer cents (`lib/donations/amount.ts`), stores a donation, creates an Orders v2 order with `intent: CAPTURE` and captures it exactly once. The page loads the PayPal SDK with `intent=capture` in its own namespace; job pages use `intent=authorize`.

Three modes: real sandbox (popup), "Continue to PayPal in this tab" (returns to `/donate/return`), and a dev-only **Simulate approval** button (`PAYPAL_SIMULATE_APPROVAL=true`, never in production). Simulated donations are tagged SIMULATED. Without PayPal credentials the page runs a labelled local simulation outside production and is switched off in production. The beneficiary is a demo placeholder, not a real organisation.

## Donation certificate

After a completed donation, `/donate/thanks/<id>` offers **Download certificate** (PDF: donor, amount, date, certificate ID, impact line, sandbox disclaimer). It is only available for completed donations and only via the unguessable donation id. It is not a receipt and implies no tax-deductibility. Impact line formula: `floor(amount / $25)` devices funded, where $25 is an illustrative estimate (`REFURB_SUBSIDY_CENTS_PER_DEVICE`).

## Verified technician profile and CV

`/tech/<id>` is public: skills, rating, and verified repairs (only jobs whose payout was released, once each, payout references shortened, demo entries tagged). **Download Verified Repair CV** returns a PDF with a QR code and link to that page.

## Recycling

When the recommended path is `recycle`, the device page offers **Book certified recycler pickup** (address and date, no payment). The recycler is a labelled demo partner. The "mark collected/processed" buttons are demo-only and absent in production. Processing adds one impact record for the device.

## Impact dashboard

`/impact` shows devices diverted (each device once), e-waste, CO2e, repairs, technician earnings, donations and pickups, two charts with text tables, and the full list of constants. **None of the constants has a verified source; all are labelled "illustrative estimate".** Seeded and simulated records are counted and footnoted as demo data.

## License

MIT, see [LICENSE](LICENSE).
