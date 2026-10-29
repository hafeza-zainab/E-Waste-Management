# ReLoop

[![License: MIT](https://img.shields.io/badge/License-MIT-teal.svg)](LICENSE)

**An AI repair agent that finds a safe, in-budget fix for a broken device, lets only *you* approve it, holds the payment in PayPal, and pays the technician only after you confirm the repair.**

> **Sandbox demo.** Everything uses the PayPal **sandbox**: no real money moves, and nothing here is a real repair shop or recycler. Built for the PayPal AI Hackathon.
> Hosted demo: `https://<your-service>.onrender.com` *(placeholder; see [docs/deploy.md](docs/deploy.md))*. The free host sleeps: **open the link a minute before judging.**

| Agent run with budget and quote | Impact dashboard | Verified technician profile |
|---|---|---|
| ![Agent trace and quote](docs/screenshots/agent-quote.png) | ![Impact](docs/screenshots/impact.png) | ![Technician profile](docs/screenshots/tech-profile.png) |

*(Screenshots were taken from a production build in demo mode, so the banner says PayPal is simulated locally. The landing page is in [docs/screenshots/landing.png](docs/screenshots/landing.png).)*

## The problem and who it is for

Most broken devices become e-waste because people can't tell whether a fix is safe or worth it, don't trust unknown repairers, and have no safe way to pay before the work is done. Skilled young technicians can't prove their track record. ReLoop is for **device owners** who want a trustworthy, affordable fix, **local technicians** (including trainees) who want to be paid fairly and build a verified record, and **communities** who want leftover devices refurbished, donated or recycled.

## What it does

1. **Agent** (`/agent`): type a goal ("My Galaxy A52 screen is cracked, fix it under $60 this weekend"). The agent diagnoses, checks safety, searches parts, matches a technician and builds a quote within budget, showing every step live.
2. **You approve, PayPal holds**: only your click unlocks PayPal checkout. The payment is *authorized*, not captured.
3. **Technician dashboard**: accept, work, complete with a proof photo.
4. **You confirm**: the payment is captured once and the technician is paid out (90%) through the PayPal Payouts API. Their **verified record** and a downloadable **CV PDF** grow.
5. **Beyond repair**: donate to the Refurbish & Donate Fund (PayPal, with a certificate PDF) or book a recycler pickup; the **impact dashboard** counts each device once.

## Architecture

```mermaid
flowchart LR
  U([Owner]) --> AG[/agent: Claude tool-use loop or scripted demo/]
  AG --> T1[diagnose_device] --> SG[Safety gate in code]
  AG --> T2[search_parts] & T3[find_technician] & T4[build_quote<br/>budget cap]
  T4 --> AP[request_user_approval]
  AP -->|user clicks Approve| TOK[single-use token]
  TOK --> OR[PayPal Orders v2<br/>intent AUTHORIZE]
  OR --> BUY[Buyer approves in PayPal]
  BUY --> HOLD[(Funds held)]
  HOLD --> TECH[Technician works + proof photo]
  TECH --> CONF[Owner confirms]
  CONF --> CAP[PayPal capture, once]
  CAP --> PAY[PayPal Payouts: 90% to technician]
  PAY --> VR[Verified record + CV PDF + impact]
  WH[PayPal webhooks] -. replay-safe .-> HOLD & CAP & PAY
  DON[Donations: Orders v2 CAPTURE] --> CERT[Certificate PDF]
```

More detail: [docs/architecture.md](docs/architecture.md).

## Exactly how PayPal is used (all sandbox)

| Where | API | What for |
|---|---|---|
| Checkout | Orders v2, `intent: AUTHORIZE`, JS SDK popup, plus full-page redirect fallback | Hold the buyer's money; amounts always come from our database, never the browser |
| Confirmation | Payments v2: capture (`PayPal-Request-Id` per job), re-authorize after the 3-day honor period, void on cancel | Capture exactly once, only when the owner confirms |
| Technician pay | Payouts API (`sender_batch_id` per job) | 90% share in integer cents; retry-safe; falls back to a labelled *simulated* payout if Payouts isn't enabled |
| Donations | Orders v2, `intent: CAPTURE`, own SDK namespace | Immediate capture, once; certificate only after capture |
| Webhooks | `PAYMENT.AUTHORIZATION.CREATED/VOIDED`, `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.PAYOUTS-ITEM.*` | Replay-safe safety net and async payout results |
| Agent gate | Our REST wrapper (the PayPal Agent Toolkit was evaluated, see `DECISIONS.md` 54) | The model has no tool that can create an order, authorize, capture or pay; a human-minted single-use token bound to job, total and line items (15 min) is required |

## Exactly how AI is used

- **Diagnosis** (Claude structured output, zod-validated): causes, severity, safety risk, recommended path, parts and labour estimate.
- **Safety gate** (plain code, not a prompt): DIY is only allowed for minor, low-risk problems; a model suggesting DIY for a swollen battery is overridden and the override is shown.
- **DIY guide** generation (refused in code when DIY isn't allowed).
- **Repair agent**: Claude tool-use loop (max 10 tool calls, 90 s timeout) over deterministic tools; goal text, photos and tool results are treated as untrusted data; budget and approval are enforced server-side.
- **Scripted fallback**: with `DEMO_MODE=true` or no API key, diagnosis uses fixtures and the agent plays a clearly labelled *scripted demo run* of three scenarios **through the same real tools and checks**. A daily cap on live calls (`AI_DAILY_CALL_CAP`) falls back to this with a notice.

## Guided demo

On the hosted demo (or any run with `DEMO_ACTIONS=true`) the landing page has **"Run guided demo (about 3 minutes)"**. It operates the real app, with a caption bar explaining each step: the agent run and budget block, the approval gate, a technician accepting and completing a job with a proof photo, the owner confirming, the payout, the safety stop, and the verified profile, donation and impact pages. Controls: pause, skip chapter, speed 1x/1.5x/2x, stop (Esc).

What it simulates: money. The tour **never calls PayPal** (no order, authorize, capture, payout or webhook; blocked in the browser and on the server). Its payment, capture and payout are recorded as `TOUR-SIMULATED` and tagged "Tour simulation" in the UI, the AI is always the scripted run, and everything it creates is excluded from impact totals, earnings, public profiles, CVs and the donation fund and is deleted when the tour ends (or on the next page load if it was interrupted). The real sandbox checkout is untouched: try it yourself with the test buyer in the Demo guide. Details: [docs/DEMO_TOUR_NOTES.md](docs/DEMO_TOUR_NOTES.md).

## What is simulated in demo mode

| Part | Demo mode (no keys) | With keys |
|---|---|---|
| AI diagnosis and agent | Scripted fixtures, labelled | Live Claude |
| PayPal checkout | Local simulation, banner says so | Real PayPal sandbox |
| Payout | Labelled *simulated* | Sandbox Payouts if enabled |
| Donations | Local simulation (off in production without PayPal) | Real PayPal sandbox |
| Recycler | Always a demo partner; "Demo control" buttons (`DEMO_ACTIONS=true`) stand in for it | same |
| Dev "Simulate buyer approval" | Local dev only; never in production | same |
| Guided demo money | `TOUR-SIMULATED` payment, capture and payout; PayPal never called | same (still never called) |

Anything simulated is tagged **SIMULATED** in the UI and database.

## Run it

**Demo mode** (no keys, 4 commands):

```bash
git clone https://github.com/hafeza-zainab/E-Waste-Management.git reloop && cd reloop
cp .env.example .env          # Windows PowerShell: Copy-Item .env.example .env
npm run setup                 # install, generate Prisma client, migrate, seed
npm run dev                   # http://localhost:3000
```

**Real mode**: edit `.env` and set `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` (sandbox app), optionally `PAYPAL_WEBHOOK_ID`, and for live AI `ANTHROPIC_API_KEY` with `DEMO_MODE=false`. `npm run paypal:check` verifies your sandbox credentials (never prints the secret). Checks: `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`. Production mode locally: `npm run build && npm start`. Wipe and reseed the local database: `npm run db:reset`.

### PayPal sandbox buyer (for checkout)

Log in to the PayPal popup with the sandbox **Personal** buyer (never the Business account):

- Email: `<sandbox buyer email>` *(set in `NEXT_PUBLIC_DEMO_BUYER_EMAIL`)*
- Password: `<fill in before submission>`

Dashboard checklist (Payouts, webhook, buyer account): [docs/deploy.md](docs/deploy.md).

## Authorization timing (verify against the live PayPal docs before submission)

PayPal authorizations have a 3-day honor period and are valid 29 days. The app re-authorizes after day 3 before capturing; at day 29 or if PayPal reports it voided/expired, the job becomes `authorization_expired` and nothing is charged.

## Verification (what was actually run)

From a fresh clone in a temp folder, following these commands: `npm run setup` (migrations + seed OK), `npm test` (all pass), lint clean, `npm run build` OK, `next start` in production mode. In that production build, with a real browser (Microsoft Edge via Playwright) at 360/412/768/1280 px: no horizontal overflow on landing, diagnosis, job, technician, agent, donate, impact, tech profile and 404; no serious/critical axe-core accessibility violations; a keyboard-only run of the agent flow (example, approve, pay) passed; the dev "Simulate buyer approval" is absent and the startup self-check logged and ignored `PAYPAL_SIMULATE_APPROVAL=true`; with sandbox credentials the PayPal SDK loads under the CSP and both the popup and the in-tab redirect reach `sandbox.paypal.com/checkoutnow`. Repeat with `BASE_URL=http://localhost:3200 npm run verify:ui`. Not run: Lighthouse (the tool produced no result with Edge), a full real-buyer approval, the hosted Render deployment. See [docs/judge-checklist.md](docs/judge-checklist.md).

## Testing

`npm test` runs ~160 Vitest tests: state machine and per-action role enforcement, capture/payout idempotency and expiry, webhooks, donations and certificate gating, PDFs, impact totals, the agent (tool schemas, 10-call cap, timeout, approval-token rules, budget, prompt injection, scripted traces), rate limiting, startup safety, CSP headers and colour contrast.

## Known limitations

- **No real authentication**: the Owner/Technician switch is a cookie for demo purposes ([SECURITY.md](SECURITY.md)).
- SQLite on an ephemeral disk: the hosted demo's data and uploaded photos reset on redeploy or restart.
- Rate limits and the daily AI cap are in memory (one instance only).
- Impact figures are **illustrative estimates with no verified sources** (labelled in the UI).
- The recycler and donation beneficiary are demo placeholders; certificates are not tax receipts.
- `npm audit`: one high advisory in the Prisma 6 CLI's `deepmerge-ts` (build-time tool); fix needs Prisma 7 (see SECURITY.md).
- The CSP allows inline scripts (required by Next.js without nonces).
- Real sandbox payouts need Payouts enabled and a real sandbox recipient email; otherwise they are simulated or show UNCLAIMED.

## Future work

Real accounts and KYC for technicians, a shared store for rate limits, Postgres, dispute handling, real recycler and charity integrations, sourced impact factors.

## License

MIT, see [LICENSE](LICENSE). Security notes: [SECURITY.md](SECURITY.md). Design decisions: [DECISIONS.md](DECISIONS.md).
