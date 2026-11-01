# Architecture

Next.js 16 (App Router, server components and server actions), Prisma 6 on SQLite, PayPal REST (sandbox), Claude API, pdf-lib for PDFs. One deployable service.

## Layers

| Layer | Where | Notes |
|---|---|---|
| UI | `app/`, `components/` | Server components read the database directly; small client components for checkout, the agent trace and donation form |
| Domain | `lib/jobs`, `lib/donations`, `lib/recycling`, `lib/impact`, `lib/profile` | Pure rules plus Prisma; money is integer cents everywhere |
| PayPal | `lib/paypal/*` | `client.ts` (hard-coded sandbox host, token cache, error normalisation with `debug_id`), `orders.ts`, `gateway.ts` (capture, reauthorize, void, payouts), `donations.ts`, `webhooks.ts`, `webhook-handler.ts` |
| AI | `lib/ai/*`, `lib/agent/*` | Diagnosis and guide with zod-validated structured output; safety gate in code; agent loop and tools |
| Security | `lib/security/*`, `proxy.ts`, `next.config.ts`, `instrumentation.ts` | Rate limits, daily AI cap, CSP and headers, startup self-check |

## Job lifecycle (single source of truth: `lib/jobs/state-machine.ts`)

`quoted -> paid -> accepted -> in_progress -> completed -> customer_confirmed -> payout_released`, plus `payout_failed` (retryable), `cancelled`, `authorization_expired`. One table lists every legal `(from, to, actor)`. Every change goes through `transitionJob`, a conditional `updateMany` (`where status = from`), so double clicks and replays are harmless. Who may do what is enforced in `lib/jobs/permissions.ts` from the session principal, never from form fields.

## Money flow

1. **Authorize**: order created from the stored quote (`intent: AUTHORIZE`, `NO_SHIPPING`, a fresh `PayPal-Request-Id` per attempt); buyer approves in the PayPal popup or full page; the server authorizes and stores the authorization.
2. **Capture**: only in `confirmRepair` (owner), `PayPal-Request-Id = reloop-capture-<job>`, stored capture id. Authorization older than 3 days is re-authorized first; older than 29 days or voided becomes `authorization_expired`.
3. **Payout**: only with a stored real capture; `sender_batch_id = reloop-payout-<job>[-r<n>]`; failures set `payout_failed` and show an idempotent Retry. A simulated capture can only produce a simulated payout.
4. **Webhooks** (`/api/paypal/webhook`): signature verified with PayPal's verify API; each event id recorded once; handlers are conditional transitions.

## The agent

```mermaid
sequenceDiagram
  participant U as User (browser)
  participant R as /api/agent/run (NDJSON stream)
  participant L as Agent loop
  participant T as Tools (zod-validated)
  participant D as DB
  participant PP as PayPal
  U->>R: goal, budget, photo
  R->>L: run (rate limited, 10 calls, 90 s)
  loop until approval requested or answer
    L->>T: tool call (from Claude or scripted)
    T->>D: diagnose / parts / technicians / quote
    T-->>L: result (untrusted data)
    L-->>U: step event
  end
  L->>T: request_user_approval (pending, no token)
  T->>D: AgentApproval(job, total, items hash, 15 min)
  L-->>U: quote card, run ends
  U->>R2: POST /api/agent/approve (session = job owner)
  R2->>D: userApprovedAt, mint single-use token (hash stored)
  U->>R3: POST /api/paypal/orders {token}
  R3->>D: verify token, job, total, items, expiry; burn token
  R3->>PP: create AUTHORIZE order
  PP-->>U: buyer approves in PayPal
```

`create_paypal_order` exists in the registry but is never offered to the model and is refused if requested. Budget is run context set by the user, not a tool argument; `build_quote` returns a blocked result (no job) when over budget.

## Data model highlights

`Job` (status, quote, ids for order/authorization/capture/payout, `authSimulated`, `agentRunId`), `JobEvent` (timeline), `VerifiedRepair` (unique per job), `Donation` (unguessable `publicId`), `RecyclingPickup`, `ImpactEvent` (unique `deviceId`: a device counts once), `Part`, `AgentRun`, `AgentApproval`, `ApprovalToken`, `WebhookEvent` (idempotency).

## Deployment shape

Single Render web service; `start` and `start:render` run migrations, idempotently upsert missing sample data on every runtime restart, then run `next start`. Existing user data and repair progress are preserved. Uploads are served by `app/uploads/[name]/route.ts` (Next does not serve files added to `public/` after build). See [deploy.md](deploy.md).
