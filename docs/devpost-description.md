# Devpost description (copy-paste ready)

**Project name:** ReLoop
**Tagline:** An AI repair agent that finds a safe, in-budget fix, lets only you approve it, and makes PayPal hold the money until the repair is verified.

## Inspiration

Most broken devices become e-waste not because they can't be fixed, but because people can't tell if a repair is safe or worth it, don't trust a stranger with their device, and have no safe way to pay before the work is done. Meanwhile skilled young technicians have no portable proof of their work. We wanted to make repair the easy, trusted choice, and to show what agentic commerce looks like when the human stays in control of the money.

## What it does

You tell the ReLoop agent what's wrong and your budget ("My Galaxy A52 screen is cracked, fix it under $60 this weekend"). The agent diagnoses the device, runs a safety check, searches a parts catalogue, matches a technician by skill, rating and distance, and builds an itemised quote. If the first quote is over budget, the code rejects it and the agent finds a cheaper compatible part. The agent can never pay: it hands you a quote, you approve it, and then you approve in PayPal. The payment is authorized and held. The technician accepts, works and uploads a proof photo; when you confirm, PayPal captures the payment once and the Payouts API pays the technician 90%. Each paid-out repair joins the technician's public verified record and a downloadable CV. Unfixable devices route to a recycler pickup or the Refurbish & Donate Fund (PayPal donations with a certificate PDF), and an impact dashboard counts each device once.

## How we built it

Next.js 16, Prisma on SQLite, Claude via tool use, and the PayPal sandbox: Orders v2 (authorize and capture), the Payments API (capture, re-authorize, void), Payouts, and webhooks. The key design choice is that safety and money rules live in code, not prompts: a hard safety gate decides whether DIY is allowed; a transition table with per-action role checks governs the job lifecycle; capture and payout are idempotent; and the agent has no tool that can create an order. Order creation for agent-built jobs needs a single-use token minted only by the user's Approve click, bound to the exact job, total and line items and valid for 15 minutes. Without API keys the app runs a scripted demo through the same real tools, clearly labelled. About 160 automated tests cover the rules, and a real-browser script checks responsiveness, accessibility and the keyboard flow.

**Guided demo.** A "Run guided demo" button drives the real app for about three minutes with a caption bar, so judges see the whole flow without clicking. It never calls PayPal: its payment, capture and payout are labelled TOUR-SIMULATED, it always uses the scripted AI, and everything it creates is excluded from impact, earnings, profiles and the donation fund and deleted afterwards. The real sandbox checkout is still one click away in the Demo guide.

## Challenges we ran into

Making a genuinely human-in-the-loop agent: the model must be useful but unable to spend money, even if the goal text or a photo tells it to ignore the rules. We solved it structurally (no payment tool, server-side token verification) and tested a prompt-injection case. PayPal sandbox quirks (stale orders being reused on retry, popup and tracking-prevention failures) led to a fresh request id per order and a full-page redirect fallback. Keeping sandbox, simulated and real paths honest meant tagging everything simulated and making it unreachable in production.

## Accomplishments that we're proud of

An agent whose trust boundary is enforced by code and tests, not by a prompt. A complete money path (authorize, capture once, payout with retry) that survives double clicks, replays and expiry. A verified-work record for technicians that is only created after a real payout. Accessibility and responsive checks run in a real browser.

## What we learned

Agentic commerce works best when the agent plans and the human commits. Deterministic tools plus a thin model loop are easier to test than a clever prompt. Idempotency keys and conditional state transitions turn most payment edge cases into non-events.

## What's next for ReLoop

Real accounts and identity checks for technicians, dispute handling, a shared store for rate limits and Postgres, real recycler and charity integrations, and sourced environmental impact factors (the current figures are labelled illustrative estimates).

## Built with

Next.js, React, TypeScript, Tailwind CSS, Prisma, SQLite, Zod, Claude API (tool use and structured output), PayPal REST APIs (Orders v2, Payments, Payouts, Webhooks) and JS SDK, pdf-lib, Vitest, Playwright, axe-core, Render.

## How this project was built during the submission period

Built from scratch during the submission period in seven phases (scaffold and data model, AI diagnosis with the code-level safety gate, PayPal checkout, job lifecycle with capture and payout, verified profiles with donations and impact, the agent with its approval gate, and hardening and deployment), with AI-assisted coding (Claude Code) and human review of each phase. The git history records every phase. *(Add your submission-period dates and team members here.)*

## Try it

- Live demo: `<hosted URL>` (free host: open it a minute early)
- Code: `<repo URL>`
- Sandbox buyer: see the README; nothing real is charged.
