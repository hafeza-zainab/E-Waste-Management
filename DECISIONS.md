# Decisions and assumptions

| # | Decision | Why |
|---|----------|-----|
| 1 | Separate git repo created inside the project folder (`git init -b main`). | The parent directory is a git repo covering the whole home directory; nesting keeps hackathon history clean. |
| 2 | Next.js 16 with `cacheComponents` and `partialPrefetching` turned **off**. | Every page reads per-request state (cookie role, SQLite). Classic dynamic rendering avoids wrapping every read in Suspense. |
| 3 | Prisma pinned to v6. | v7 requires driver adapters and a config file; v6 keeps `npm run setup` simple for judges. |
| 4 | `.npmrc` sets `legacy-peer-deps=true`. | npm 10 crashes (`edgesOut` arborist bug) resolving vitest's optional peers. |
| 5 | shadcn-style components are hand-written in `components/ui` (cva + tailwind-merge) with a `components.json`. | The shadcn CLI is interactive and assumes a PostCSS Tailwind setup; this scaffold uses the Turbopack Tailwind loader. |
| 6 | Statuses and types are strings validated in TypeScript/zod, not DB enums. | Prisma does not support enums on SQLite. |
| 7 | Money is stored as integer cents everywhere. | Avoids float drift in fee/payout maths. |
| 8 | Platform fee applies to the whole job total (default 10%, `PLATFORM_FEE_BPS`). | Simple, visible, testable. |
| 9 | Role switcher is a plain httpOnly cookie, no authentication. | Per brief; demo only. |
| 10 | Landing-page scenario buttons open `/owner/new?scenario=...`, which prefills the intake form. | Fast, scripted demo entry. |
| 11 | Default model is `claude-opus-5-5` (one constant in `lib/ai/config.ts`, overridable with `ANTHROPIC_MODEL`). | Current recommended model per Anthropic docs. Cheaper models can be swapped in with the env var. |
| 12 | Environmental impact is computed in code from `lib/impact`, never by the model. | Transparent, auditable, testable. |
| 13 | Demo mode = `DEMO_MODE != "false"` OR no `ANTHROPIC_API_KEY`. | Judges never hit a missing-key error. |
| 14 | The swollen-battery fixture simulates a model wrongly suggesting `diy`; the code gate overrides it to `technician`. | Makes the code-level safety gate visible in the demo. Real-mode output is never altered except by the gate. |
| 15 | Demo-mode free-text cases are keyword-matched to a scripted scenario, else get a clearly labelled generic fixture. | The app stays usable without a key but never pretends to be a real diagnosis. |
| 16 | DIY guide route re-checks `diy_allowed` on read, and `generateGuide` refuses when it is false. | Defence in depth for the safety rule. |
| 17 | Uploads are identified by magic bytes, limited to 4 MB, saved to `public/uploads` with random names. | Never trust client MIME type or filename. Files are ephemeral on Render free tier. |
| 18 | Booking/quote CTAs for technician, donate and recycle paths are intentionally absent until Phases 3, 5 and 6. | No fake buttons. |
| 19 | PayPal base URL is hard-coded to `api-m.sandbox.paypal.com`. | The app can never touch live money. |
| 20 | Checkout uses intent `AUTHORIZE`: funds are held at approval and captured only on verified completion (Phase 4). | Matches the "release only after verified repair" promise without a platform balance. Sandbox authorizations last 29 days. |
| 21 | Without PayPal credentials the app runs a clearly labelled local simulation (`SIM-` ids, same server flow, banner says so). | Judges can run the full flow with no keys. |
| 22 | Order amount is always read from the stored quote in the DB; the browser only sends a job id. The authorize route checks the order id belongs to the job. | Prevents amount tampering and cross-job authorization. |
| 23 | PayPal-Request-Id is deterministic per job/order (`reloop-order-<job>`, `reloop-authorize-<order>`); state changes are conditional transitions (`updateMany where status = from`); webhook event ids are unique. | Retries, double clicks and webhook replays are harmless. |
| 24 | Webhook route verifies signatures with PayPal's verify-webhook-signature API and only trusts `*.paypal.com` cert URLs. A dev-only `/api/paypal/webhook/simulate` replays the same handler without a signature. | Safe by default, testable locally. Simulate route is 404 in production unless PayPal is simulated. |
| 26 | Order creation uses a **fresh PayPal-Request-Id per attempt** (was deterministic per job). | A deterministic id returned the same, possibly stuck, order after a failed approval, so retries could never succeed. Double-click safety now comes from the job storing the latest order id and the authorize route rejecting any other. |
| 27 | Orders use `payment_source.paypal.experience_context` (not the deprecated `application_context`), all items are `DIGITAL_GOODS`, zero-value items are dropped. | Current PayPal field; a service with `NO_SHIPPING` should not carry `PHYSICAL_GOODS` lines. |
| 28 | The SDK client id is always the server's `PAYPAL_CLIENT_ID`; `NEXT_PUBLIC_PAYPAL_CLIENT_ID` is ignored. | A browser/server app mismatch is a classic `genericError` cause; one source removes the class of bug. |
| 29 | Full-page redirect flow ("Continue to PayPal in this tab") returns to `/jobs/[id]/return`, which authorizes server-side. Popup errors are POSTed to `/api/paypal/client-error` (debug id logged). | Works when popups or tracking prevention break the SDK. |
| 30 | **Dev-only "Simulate buyer approval"** (`NODE_ENV != production` AND `PAYPAL_SIMULATE_APPROVAL=true`). Stores `authSimulated=true`, tagged SIMULATED everywhere; capture and payout for it are also simulated (never a real PayPal call). | Unblocks development without hiding the sandbox problem. **Shipping requirement: a real sandbox authorization, capture and payout must be demonstrated end to end before submission.** |
| 31 | One transition table (`lib/jobs/state-machine.ts`) lists every legal `(from, to, actor)`; every state change goes through `transitionJob`, a conditional `updateMany`. Who may trigger each action is enforced in `lib/jobs/permissions.ts` using the session principal, never form fields. | Illegal moves and wrong actors are impossible server-side, not just hidden. The cookie "session" is still demo-grade, not real authentication. |
| 32 | Capture happens only in `confirmRepair`, with `PayPal-Request-Id = reloop-capture-<jobId>` and a stored `captureId`. Payout only runs with a stored capture. | Exactly-once capture; no payout without money in hand. |
| 33 | Authorization timing: 3-day honor period, valid 29 days. After day 3 we call re-authorize before capture (if PayPal refuses we still try the original); past day 29, or when PayPal says voided/expired, the job becomes `authorization_expired` and nothing is charged. | PayPal Payments v2 behaviour as documented; the docs site could not be re-fetched during this session, so verify these numbers against the live docs before submission. |
| 34 | Payouts use `sender_batch_id = reloop-payout-<jobId>[-r<n>]`; `n` increases only after PayPal reports an item failed/returned. A duplicate-batch rejection is treated as "already submitted". Payouts 401/403 (not enabled) records a labelled `simulated` payout with the reason. | A retry can never pay twice, and a genuinely failed item can be re-sent under a new id. |
| 35 | The owner's "Report a problem" sets a flag that blocks capture; the technician clears it by uploading new proof. | Gives the owner a safe exit without a dispute system. |
| 36 | Odd-cent fee maths: `fee = floor((total * bps + 5000) / 10000)` (half-up, integer only); technician gets the remainder. | $0.99 -> fee 10c / payout 89c; $33.33 -> fee 333c / payout 3000c. |
| 25 | Platform fee is deducted from the technician's share, shown on the quote. The customer pays exactly the quoted total. | Transparent for both sides. |
