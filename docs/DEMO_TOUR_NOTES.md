# Guided demo ("Run guided demo") notes

A narrated tour that drives the **real app**: it types into the real agent form, clicks the real buttons and switches a **tour-only identity** (owner or technician), while a caption bar explains each step. The default tour now targets **2 minutes 30 seconds at 1x**, excluding pauses and the final user decision. It reuses complete existing recordings at normal speed, narrates the main explanations and performs routine actions silently. Profile/CV and donation detours are omitted; approval, both PayPal editor slates, simulated payment, technician proof, owner confirmation, safety and impact remain. The signup entry adds one brief form explanation. Network and server waits can extend the duration; `npm run verify:tour` measures the home tour and fails its duration check above 150 seconds. No browser measurement of the shortened version has been made yet.

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
| Routes | `app/api/tour/start`, `/role`, `/pay`, `/cleanup` |
| Sample proof photo (made for this project, no third-party content) | `public/tour/sample-proof.png` |

Targets are found **only** by `data-tour="..."` attributes (no position-based selectors). `name@job` narrows to the element inside the tour job's own card or form, because the seeded technician board has other jobs.

### Chapters (target 2:30 at 1x)

1. The flow (landing page). 2. The agent (goal, budget, tool trace and quote). 3. You stay in control (Approve, editor slates, TOUR-SIMULATED payment and job page). 4. Technician side (tour identity, accept, start, photo, notes, complete). 5. Confirm and pay out (owner confirmation and simulated payout). 6. Safety first (swollen battery and DIY blocked). 7. Impact (tour data excluded). 8. Your turn (sandbox guide or Finish).

Chapter 3 differs slightly from the brief: for agent-built jobs the PayPal button lives on the agent page (after Approve), not on the job page, so that is where it is highlighted before the tour moves to the job page.

### Controls

Pause/Resume, Skip chapter, Speed 1x/1.5x/2x, Stop (Esc). A real click or key press on the page pauses the tour ("Paused because you used the page"); the tour's own clicks are synthetic (`isTrusted` false) and never pause it. The app's handlers must keep ignoring `isTrusted` for the tour to work (comment in `lib/tour/controller.ts`).

If a target is missing the step is skipped with a console warning and the chapter is abandoned; chapters that depend on it (`needs`) are skipped; after two failures the tour ends with a visible "Tour ended early" message. It never leaves a half-driven page without a message.

## Data safety

- Every record a tour creates carries `isTour = true` and `tourRunId` (devices, jobs, agent runs). A `TourRun` row plus an httpOnly cookie (`reloop_tour`) is the session; a readable flag cookie (`reloop_tour_on`, no id) tells the next page load that a session may exist.
- Tour jobs can only be moved by the session that owns them: `lib/jobs/lifecycle.ts` calls `assertTourJobAccess` for every action (valid cookie bound to the job's `tourRunId`, `DEMO_ACTIONS=true`). `/api/tour/pay` additionally requires the user's real Approve click and a non-expired approval.
- Excluded everywhere: impact totals and earnings, technician earnings, public technician profiles and CV exports, the donation fund total, webhook handling. Tour repairs never create a `VerifiedRepair` or `ImpactEvent`. Other visitors do not see them in My repairs or the technician board.
- Cleanup runs on **Finish**, on **Stop**, on the **next page load** after an interrupted run (state stale for more than 20 s, or session lost), and as a **server purge** of runs older than 2 hours (and orphaned tour records) whenever a new tour starts. A reload within 20 s resumes the current step from its beginning, without replaying completed steps.
- `sessionStorage` holds `{runId, chapter, startedAt, speed, job, heartbeat}`. State from a different or expired run is discarded and cleaned.

## Editing

- Wording: edit `docs/tour-captions.json`. A caption must describe only what is on screen when it appears; `tests/tour-script.test.ts` fails if a caption has no target or the target does not exist in the markup.
- Timing: `compactChapter`, `SHORT_NARRATION` and `TOUR_TIMING` in `lib/tour/script.ts` define the default short tour. The full caption/target catalog is retained for reuse and validation. Steps with `narration: false` keep their captions and actions but do not play audio. The timing test reserves at least 12 seconds for network/target waits within the 150-second target at either entry point. Saved progress from the previous script version is cleaned rather than resumed at changed step indices.
- New step: add the `data-tour` attribute to the element, then a step in `script.ts`.

## Verifying

- Unit tests: `npm test` (runner, guards, authorization, cleanup, exclusions, script checks).
- Browser: `npm run build` then `npm run verify:tour` (own production server, throwaway database, dummy PayPal credentials so any PayPal call would be visible). Runs the whole tour at 1280 px (1x) and 412 px (2x), checks zero PayPal requests, no console errors, an axe check of the caption bar, no leftovers, a reload-resume, an abandoned tab and stale state. `npm run verify:ui` runs it too (`SKIP_TOUR=1` to skip).

## Entry points and the identity overlay (accounts)

There are two **Run guided demo** buttons. Both start the same tour; the tour state carries `returnTo` and `preserveSession`.

| | Signup page (`/signup`) | Home page (`/`) |
|---|---|---|
| `returnTo` / `preserveSession` | `"/signup"` / false | `"/"` / true |
| Extra chapter | **Accounts** (first): points at the signup form, the Owner/Technician choice and the guest button. Only "say" steps: it never types into or submits the form and never creates a user. | none |
| On finish **and** on Stop | cleanup, then navigate to `/signup` | cleanup, then navigate to `/`; the visitor's session is left exactly as it was |

**The tour never touches the real session.** It used to switch a role cookie; now:

- `POST /api/tour/role` sets `reloop_tour_role` (httpOnly, bound to the tour run id): `<runId>:owner` or `<runId>:technician:<techId>`. A technician is accepted only if they have a job in this very run.
- While a tour session is valid, `getPrincipal()` returns the overlay identity and the visitor's `reloop_session` cookie is not consulted at all. The overlay has `tourRunId` set and `checkPermission` enforces the boundary both ways: a tour identity reaches only jobs of its own run; a real identity never reaches a tour job.
- Tour records belong to a dedicated owner profile (`tour-visitor@reloop.invalid`), never to the visitor's own owner profile, so the visitor's dashboards and data are not shown, modified or counted.
- `proxy.ts` does not refresh the session cookie while the `reloop_tour_on` flag is present, so the cookie is not even re-sent.
- The caption bar shows **"Viewing as: Technician (tour): <name>"** or **"Owner (tour)"** when the overlay switches. The header shows "Guided demo" instead of the visitor's account.
- Cleanup (finish, Stop, interrupted reload, 2-hour purge) also clears the overlay cookie.

`tests/tour-identity.test.ts` covers the cookie, the boundaries and the untouched session; `scripts/verify-auth.ts` (`npm run verify:auth`) runs both entry points in a real browser: finish, Stop, reload, logged in / guest / logged out, zero PayPal requests, axe on the caption bar.

## Recorded narration and editor slates

Voiceover is AI-generated. The browser plays only manifest-listed `/tour/audio/<stepId>.mp3` files using one HTMLAudioElement. The manifest is bundled at build time: generate audio before building, and rebuild after regeneration. No speech-synthesis fallback or external TTS requests exist. Missing or failed audio is silent, with one warning per ID in development. Narration on/off and volume are saved in localStorage; the URL `?narration=off` overrides the saved setting for the run. Autoplay is primed from the demo click; if blocked, the tour continues silently and offers “Tap to enable sound” to start the current sentence. Finished sentences are not replayed when sound is enabled.

Each step runs for at least its existing wait and until audio ends plus 0.4 seconds. Narration playback follows speed with preserved pitch, capped at 1.5x even when actions run at 2x. Pause/Resume, Skip, Stop, Escape and Finish affect audio. A stalled file times out after 15 seconds without progress, allowing a silent continuation. Step checkpoints in sessionStorage prevent completed steps replaying after reload.

`paypal-slate` and `paypal-slate-end` bracket the cut point for the real PayPal clip: cut out these editor banners and insert the separately recorded sandbox checkout, capture and payout between them.

The first slate says “Now showing how PayPal works here” with “Real sandbox checkout, capture and payout”; the second says “Back in the guided demo”. They are editor placeholders only, never PayPal actions. The first holds until its audio ends plus 3 seconds (minimum 3 seconds without audio). Optional server env `TOUR_SLATE_HOLD` sets its minimum hold in seconds, still allowing speech to finish. The return slate holds at least 1.5 seconds and allows its sentence to finish. Generate both new MP3s yourself after updating the steps, then rebuild; until then both slates remain silent.

`?record=1` enables recording presentation for the run: caption bar stays visible, narration stays available, smooth scrolling and ring transitions are disabled, and Next dev overlays, marked dev-only overlays, cookie banners and toast presentation are hidden. The sandbox notice remains visible. This flag does not alter sessions, approval, payment or safety behavior. There is no cookie-consent banner in the current app. Preferences still apply; turn narration on and set volume before recording, or use `?narration=off` deliberately for a silent capture.

Unit tests cover narrator selection, timing, persistence, lifecycle and blocked playback. `verify:tour` uses a mock Audio element with the actual manifest durations and reports the 1x home tour duration. `verify:auth` uses short mock audio for repeated identity checks. Browser mocks do not verify actual speaker output, MP3 pronunciation, loudness, pitch handling or recording desktop audio; listen manually. Slate audio checks require regenerating the manifest and rebuilding first.
