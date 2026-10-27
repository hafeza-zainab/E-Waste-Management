# Judge checklist

> The official hackathon rules and judging rubric were not available to the author while writing this. The rows below map **common** requirements and the two prize tracks named in the project brief to where they are satisfied. **Please check each row against the official rules text before submitting** and edit anything that doesn't match.

## Prize tracks

| Track | How ReLoop addresses it | Where |
|---|---|---|
| Best Use of Agentic Commerce | An agent that plans a purchase (parts + labour + logistics) within a budget, with a structural human-approval gate before any payment, single-use approval tokens and budget enforcement in code | `lib/agent/*`, `app/api/agent/*`, `tests/agent.test.ts`, README "Exactly how PayPal is used" |
| Best Use of PayPal + AI | PayPal authorize / capture / payout / donations / webhooks driven by an AI-built, human-approved quote; AI diagnosis feeding a code safety gate | `lib/paypal/*`, `lib/jobs/lifecycle.ts`, `lib/ai/*` |

## Generic criteria

| Criterion | Evidence | Where |
|---|---|---|
| Uses PayPal meaningfully | Orders v2 (AUTHORIZE and CAPTURE), Payments (capture, re-authorize, void), Payouts, signed webhooks, JS SDK popup + redirect fallback | `lib/paypal/`, `app/api/paypal/`, `app/donate/` |
| Uses AI meaningfully | Structured diagnosis, DIY guide, tool-using agent; AI output is validated and constrained by code | `lib/ai/`, `lib/agent/` |
| Works end to end | Seed data + scripted demo run the whole flow without keys; real sandbox flow with keys | README "Run it", `docs/demo-script.md` |
| Technical quality | ~160 Vitest tests; typecheck, lint, production build clean; idempotent money paths; fresh-clone run | `tests/`, README "Verification" |
| Security and safety | Rate limits, daily AI cap, CSP and headers, input limits, secret hygiene, production self-check, no simulated approval in production | `SECURITY.md`, `lib/security/`, `next.config.ts` |
| Design and UX | Responsive at 360-1280 px, keyboard-only flow, axe-core clean, AA contrast, toasts, skeleton and error pages, judge "Demo guide" | `scripts/verify-ui.ts`, `components/` |
| Impact and originality | Repair-first marketplace with verified technician records, donation fund and recycling; impact counted once per device with honest "illustrative estimate" labels | `/impact`, `lib/impact/` |
| Honesty about limits | Simulated parts labelled SIMULATED; limitations listed | README "Known limitations", `DECISIONS.md` |
| Open source / licence | MIT | `LICENSE` |
| Reproducible build | `render.yaml`, health check, idempotent seed, deploy guide | `render.yaml`, `docs/deploy.md` |

## Submission requirements to confirm manually

- [ ] Hosted demo URL works (open it a minute early) and the PayPal sandbox buyer logs in
- [ ] Public repo URL, licence visible
- [ ] 2:45 demo video recorded and uploaded (see `docs/demo-script.md`)
- [ ] Devpost text pasted from `docs/devpost-description.md`; submission-period dates and team added
- [ ] README password for the sandbox buyer filled in
- [ ] Any rule about third-party APIs / AI disclosure satisfied (Claude API and PayPal sandbox are used; both are disclosed)
