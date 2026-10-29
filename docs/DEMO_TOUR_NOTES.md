# Guided demo ("Run guided demo") notes

A narrated tour that drives the **real app**: it types into the real forms, clicks the real buttons and switches the real role switcher, while a caption bar explains each step. Because it operates the product instead of playing a video, the captions cannot drift out of sync with it. It takes about 3 to 3.5 minutes at 1x speed (measured: 3:16).

> The reference files from the CampusSync tour (`docs/reference/*`) were not in this repo when it was built, so the design was done from the written brief. Nothing was ported.

## What it never does

- It **never calls PayPal**: no order, authorize, capture, payout or webhook. Three independent layers enforce it:
  1. the browser guard (`lib/tour/paypal-client-guard.ts`) refuses any fetch/XHR to a PayPal host or `/api/paypal/*` and removes PayPal script tags while a tour runs;
  2. the server guard (`lib/tour/paypal-guard.ts`) returns 403 from `/api/paypal/orders`, `/api/paypal/orders/*/authorize`, `/api/donations` and its capture route for a tour session or a tour job;
  3. tour jobs use `TOUR-SIMULATED` ids (`SIM-TOUR-...`); capture and payout for them are computed locally in `lib/jobs/lifecycle.ts`, and webhooks ignore tour records.
- It never calls Claude, even with an API key: tour runs force the scripted path (`tourRunId` makes `runAgent` and `diagnose` scripted).
- It does not change money, safety or approval rules. The agent still cannot pay, the Approve click still mints the approval token, and `PAYPAL_SIMULATE_APPROVAL` is still ignored in production.

## How it works

| Piece | File |
|---|---|
| Steps and chapters as data | `lib/tour/script.ts` |
| Wording (edit this) | `docs/tour-captions.json` |
| Timing: one `wait(ms)`, speed multiplier, pause/skip/abort checks every 50 ms | `lib/tour/runner.ts` |
| Browser engine: finds `data-tour` targets, types, clicks, uploads, highlights, resumes, cleans up | `lib/tour/controller.ts` |
| Caption bar, controls, landing button | `components/tour/tour-host.tsx` |
| Session, cleanup, exclusions helpers | `lib/tour/server.ts` |
| Routes | `app/api/tour/start`, `/pay`, `/cleanup` |
| Sample proof photo (made for this project, no third-party content) | `public/tour/sample-proof.png` |

Targets are found **only** by `data-tour="..."` attributes (no position-based selectors). `name@job` narrows to the element inside the tour job's own card or form, because the seeded technician board has other jobs.

### Chapters (about 3 minutes at 1x)

1. The problem (landing page) 2. The agent (goal, budget, trace, rejected over-budget quote, quote) 3. You stay in control (Approve, PayPal button is **not** loaded, tour-only TOUR-SIMULATED hold, job page) 4. Technician side (role switcher, accept, start, proof photo, complete) 5. Confirm and pay out (owner, confirm, TOUR-SIMULATED payout, timeline) 6. Safety first (swollen battery, red stop, "DIY is not offered") 7. Proof, giving and impact (seeded technician profile, CV button not clicked, donate page with PayPal not loaded, impact) 8. Your turn (**Try the real sandbox checkout** opens the Demo guide, or **Finish**).

Chapter 3 differs slightly from the brief: for agent-built jobs the PayPal button lives on the agent page (after Approve), not on the job page, so that is where it is highlighted before the tour moves to the job page.

### Controls

Pause/Resume, Skip chapter, Speed 1x/1.5x/2x, Stop (Esc). A real click or key press on the page pauses the tour ("Paused because you used the page"); the tour's own clicks are synthetic (`isTrusted` false) and never pause it. The app's handlers must keep ignoring `isTrusted` for the tour to work (comment in `lib/tour/controller.ts`).

If a target is missing the step is skipped with a console warning and the chapter is abandoned; chapters that depend on it (`needs`) are skipped; after two failures the tour ends with a visible "Tour ended early" message. It never leaves a half-driven page without a message.

## Data safety

- Every record a tour creates carries `isTour = true` and `tourRunId` (devices, jobs, agent runs). A `TourRun` row plus an httpOnly cookie (`reloop_tour`) is the session; a readable flag cookie (`reloop_tour_on`, no id) tells the next page load that a session may exist.
- Tour jobs can only be moved by the session that owns them: `lib/jobs/lifecycle.ts` calls `assertTourJobAccess` for every action (valid cookie bound to the job's `tourRunId`, `DEMO_ACTIONS=true`). `/api/tour/pay` additionally requires the user's real Approve click and a non-expired approval.
- Excluded everywhere: impact totals and earnings, technician earnings, public technician profiles and CV exports, the donation fund total, webhook handling. Tour repairs never create a `VerifiedRepair` or `ImpactEvent`. Other visitors do not see them in My repairs or the technician board.
- Cleanup runs on **Finish**, on **Stop**, on the **next page load** after an interrupted run (state stale for more than 20 s, or session lost), and as a **server purge** of runs older than 2 hours (and orphaned tour records) whenever a new tour starts. A reload mid-chapter within 20 s resumes the same run at the start of that chapter.
- `sessionStorage` holds `{runId, chapter, startedAt, speed, job, heartbeat}`. State from a different or expired run is discarded and cleaned.

## Editing

- Wording: edit `docs/tour-captions.json`. A caption must describe only what is on screen when it appears; `tests/tour-script.test.ts` fails if a caption has no target or the target does not exist in the markup.
- Timing: the `ms` of each step in `lib/tour/script.ts` (scaled by the speed setting).
- New step: add the `data-tour` attribute to the element, then a step in `script.ts`.

## Verifying

- Unit tests: `npm test` (runner, guards, authorization, cleanup, exclusions, script checks).
- Browser: `npm run build` then `npm run verify:tour` (own production server, throwaway database, dummy PayPal credentials so any PayPal call would be visible). Runs the whole tour at 1280 px (1x) and 412 px (2x), checks zero PayPal requests, no console errors, an axe check of the caption bar, no leftovers, a reload-resume, an abandoned tab and stale state. `npm run verify:ui` runs it too (`SKIP_TOUR=1` to skip).
