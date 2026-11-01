# Deploying ReLoop to Render (free plan)

ReLoop runs as one Render web service with SQLite on the instance's disk. Everything uses the **PayPal sandbox**; no real money moves.

> The Blueprint and these steps were written but **not executed against Render** by the author (no Render account was available while building). The same start command was exercised locally in production mode; see the README "Verification" section.

## 1. Create the service

1. Push the repo to GitHub.
2. Render dashboard > **New** > **Blueprint** > pick the repo. Render reads `render.yaml` and proposes the `reloop` web service (free plan).
3. Fill in the values it asks for (all marked `sync: false`, none of them is stored in the repo):

| Variable | Value |
|---|---|
| `PAYPAL_CLIENT_ID` | Sandbox app client ID (developer.paypal.com > Apps & Credentials > Sandbox) |
| `PAYPAL_CLIENT_SECRET` | Same app's secret |
| `PAYPAL_WEBHOOK_ID` | Fill in after step 3 below (leave empty for the first deploy) |
| `NEXT_PUBLIC_APP_URL` | `https://<your-service>.onrender.com` (if left empty the app falls back to Render's `RENDER_EXTERNAL_URL`) |
| `ANTHROPIC_API_KEY` | Optional. Without it the AI is the scripted demo. |
| `NEXT_PUBLIC_DEMO_BUYER_EMAIL` | The sandbox **Personal** buyer's email, shown in the Demo guide (public by design) |
| `NEXT_PUBLIC_DEMO_BUYER_NOTE` | e.g. `US Personal sandbox buyer. Password is in the README.` |

Already set by the Blueprint: `NODE_ENV=production`, `DATABASE_URL=file:./prod.db`, `DEMO_MODE=true`, `DEMO_ACTIONS=true`, `PAYPAL_SIMULATE_APPROVAL=false`, `AI_DAILY_CALL_CAP=200`, `PLATFORM_FEE_BPS=1000`.

To use the live Claude agent: add `ANTHROPIC_API_KEY` and set `DEMO_MODE=false`. Live calls are capped per day by `AI_DAILY_CALL_CAP`; beyond it the app switches back to the scripted demo with a visible notice.

## 2. What happens on every boot

`npm run start:render` runs `prisma migrate deploy`, then `prisma/seed.ts`, then `next start -H 0.0.0.0` (Next reads Render's `PORT` itself):

- Migrations are applied to the SQLite file.
- Both `npm start` and `npm run start:render` apply migrations and upsert missing sample data on every runtime start, even on a nonempty database. Stable sample IDs prevent duplicates; existing user data and repair progress are preserved. Leave `DEMO_ACCOUNT_PASSWORD` unset for the public judge credentials shown on login/signup and in the README. A private override is never displayed. `npm run db:reset` explicitly wipes and reseeds locally; `SEED_RESET` no longer triggers a reset on production startup.
- The free tier's disk is **ephemeral**: the database and uploaded photos are recreated on every redeploy and restart. That is fine for a demo; a missing photo shows a short note instead of a broken page.

The health check is `GET /api/health` (200 when the database answers).

## 3. Create the PayPal webhook

1. developer.paypal.com > Apps & Credentials > Sandbox > your app > **Webhooks** > **Add Webhook**.
2. Webhook URL: `https://<your-service>.onrender.com/api/paypal/webhook`
3. Subscribe to exactly these events:
   - `PAYMENT.AUTHORIZATION.CREATED`
   - `PAYMENT.AUTHORIZATION.VOIDED`
   - `PAYMENT.CAPTURE.COMPLETED`
   - `PAYMENT.PAYOUTS-ITEM.*` (all payout item events)
4. Save, copy the **Webhook ID** and put it in Render as `PAYPAL_WEBHOOK_ID`, then redeploy (or restart) the service.

Without the webhook ID every webhook is rejected, but checkout, capture and payout still work because the app handles them in its own API calls. Webhooks add resilience and the asynchronous payout results.

## 4. PayPal sandbox prerequisites

- A sandbox **Personal** buyer account (country US, funded in USD) for checkout. Never use the Business account to pay.
- Payouts enabled on the sandbox app (Features > Payouts) and USD balance on the Business account; otherwise the app records a clearly labelled *simulated* payout.
- To make a real payout visible, set `PAYPAL_PAYOUT_RECEIVER_OVERRIDE` to a sandbox Personal email (dev/staging only; ignored in production).

## 5. Cold starts

Render's free tier sleeps after about 15 minutes without traffic, and the first request can take close to a minute. **Open the URL a minute or two before a demo or judging** and click through one page so the server is warm.

## 6. Checklist after deploy

- [ ] `https://<url>/api/health` returns `{"ok":true}`
- [ ] Landing page shows the amber sandbox banner
- [ ] `/agent` > cracked-screen example runs and shows a quote
- [ ] Approve > PayPal popup opens with the sandbox buyer (and "Continue in this tab" works)
- [ ] Render logs show one `startup` line with the active modes and **no** secret values
- [ ] No "Simulate buyer approval" button anywhere (it is disabled in production)
