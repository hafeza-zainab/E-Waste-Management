import captionsJson from "../../docs/tour-captions.json";

/**
 * The guided demo as data. Each step names the caption it shows (docs/tour-captions.json) and the `data-tour`
 * target that must be visible while that caption is on screen: tests/tour-script.test.ts checks both exist, so a
 * caption can never promise something the page does not show. Targets ending in "@job" are narrowed to the tour's job.
 * No selector in this file is position-based.
 */
export type Step =
  | { t: "slate"; id: "paypal-slate" | "paypal-slate-end"; cap: string; ms: number }
  | { t: "say"; cap: string; target: string; ms: number; optional?: boolean }
  | { t: "click"; target: string; cap?: string; ms?: number; optional?: boolean }
  | { t: "type"; target: string; text: string; cap: string }
  | { t: "role"; role: "owner" | "technician"; cap: string; target: string } // switches the TOUR-ONLY identity overlay; never the real session
  | { t: "upload"; target: string; url: string; cap: string }
  | { t: "wait"; target: string; timeoutMs?: number }
  | { t: "nav"; to: "/" | "$jobPath" | "$seededTechPath" }
  | { t: "capture" } // reads job id, technician id and name from the quote card
  | { t: "end"; cap: string };

export interface Chapter {
  id: string;
  title: string;
  /** Chapter needs what an earlier chapter produced; skipped (not run half-way) when it is missing. */
  needs?: ("job" | "paid" | "completed")[];
  steps: Step[];
}

export const GOAL_TEXT = "My Galaxy A52 screen is cracked, fix it under $60 this weekend";
export const SAMPLE_PROOF_URL = "/tour/sample-proof.png";
export const PROOF_NOTES = "Replaced the cracked display and tested touch, brightness and the camera.";
const sec = (n: number) => n * 1000;

/** Where the visitor goes when the tour ends or is stopped. "/" additionally promises the real session is left exactly as it was. */
export type ReturnTo = "/" | "/signup";
export const RETURN_PATHS: readonly ReturnTo[] = ["/", "/signup"];

/** Extra chapter that only runs when the tour was started from the signup page. It only talks: it never types into or submits the form. */
const ACCOUNTS_CHAPTER: Chapter = {
  id: "accounts",
  title: "Accounts",
  steps: [
    { t: "say", cap: "accounts.form", target: "signup-form", ms: sec(7) },
    { t: "say", cap: "accounts.roles", target: "signup-roles", ms: sec(9) },
    { t: "say", cap: "accounts.guest", target: "guest-button", ms: sec(6) },
  ],
};

const BASE_CHAPTERS: Chapter[] = [
  {
    id: "problem",
    title: "The problem",
    steps: [
      { t: "nav", to: "/" },
      { t: "say", cap: "problem.problem", target: "problem", ms: sec(7) },
      { t: "say", cap: "problem.flow", target: "flow", ms: sec(7) },
    ],
  },
  {
    id: "agent",
    title: "The agent",
    steps: [
      { t: "click", target: "nav-agent", cap: "agent.open" },
      { t: "wait", target: "goal" },
      { t: "type", target: "goal", text: GOAL_TEXT, cap: "agent.goal" },
      { t: "type", target: "budget", text: "60", cap: "agent.budget" },
      { t: "click", target: "start-agent", cap: "agent.start", ms: sec(1.5) },
      { t: "say", cap: "agent.trace", target: "trace", ms: sec(6) },
      { t: "wait", target: "quote-card", timeoutMs: sec(45) },
      { t: "say", cap: "agent.blocked", target: "trace-blocked", ms: sec(7), optional: true },
      { t: "capture" },
      { t: "say", cap: "agent.quote", target: "quote-card", ms: sec(7) },
    ],
  },
  {
    id: "control",
    title: "You stay in control",
    needs: ["job"],
    steps: [
      { t: "say", cap: "control.gate", target: "approve", ms: sec(8) },
      { t: "click", target: "approve", cap: "control.approve", ms: sec(1) },
      { t: "say", cap: "control.paypal", target: "paypal-button", ms: sec(9) },
      { t: "slate", id: "paypal-slate", cap: "control.paypalSlate", ms: sec(3) },
      { t: "slate", id: "paypal-slate-end", cap: "control.paypalSlateEnd", ms: sec(1.5) },
      { t: "click", target: "tour-pay", cap: "control.tourpay", ms: sec(3) },
      { t: "wait", target: "job-link" },
      { t: "say", cap: "control.held", target: "job-link", ms: sec(2.5) },
      { t: "click", target: "job-link" },
      { t: "wait", target: "timeline" },
      { t: "say", cap: "control.job", target: "timeline", ms: sec(5) },
    ],
  },
  {
    id: "technician",
    title: "Technician side",
    needs: ["job", "paid"],
    steps: [
      { t: "role", role: "technician", target: "tour-bar", cap: "technician.switch" },
      { t: "wait", target: "nav-technician" },
      { t: "click", target: "nav-technician" },
      { t: "wait", target: "accept@job", timeoutMs: sec(20) },
      { t: "say", cap: "technician.board", target: "accept@job", ms: sec(3) },
      { t: "click", target: "accept@job", cap: "technician.accept", ms: sec(1) },
      { t: "wait", target: "start@job", timeoutMs: sec(20) },
      { t: "click", target: "start@job", cap: "technician.start", ms: sec(1) },
      { t: "wait", target: "proof-photo@job", timeoutMs: sec(20) },
      { t: "upload", target: "proof-photo@job", url: SAMPLE_PROOF_URL, cap: "technician.photo" },
      { t: "type", target: "proof-notes@job", text: PROOF_NOTES, cap: "technician.notes" },
      { t: "click", target: "complete@job", cap: "technician.complete", ms: sec(1.5) },
    ],
  },
  {
    id: "payout",
    title: "Confirm and pay out",
    needs: ["job", "paid", "completed"],
    steps: [
      { t: "role", role: "owner", target: "tour-bar", cap: "payout.owner" },
      { t: "wait", target: "nav-technician" },
      { t: "nav", to: "$jobPath" },
      { t: "wait", target: "confirm", timeoutMs: sec(20) },
      { t: "say", cap: "payout.open", target: "job-quote", ms: sec(3) },
      { t: "click", target: "confirm", cap: "payout.confirm", ms: sec(2) },
      { t: "wait", target: "payout-card", timeoutMs: sec(20) },
      { t: "say", cap: "payout.paid", target: "payout-card", ms: sec(10) },
      { t: "say", cap: "payout.timeline", target: "timeline", ms: sec(4) },
    ],
  },
  {
    id: "safety",
    title: "Safety first",
    steps: [
      { t: "nav", to: "/" },
      { t: "say", cap: "safety.home", target: "scenario-swollen-battery", ms: sec(3) },
      { t: "click", target: "scenario-swollen-battery", cap: "safety.scenario", ms: sec(1) },
      { t: "wait", target: "diagnose" },
      { t: "click", target: "diagnose", cap: "safety.diagnose", ms: sec(1) },
      { t: "wait", target: "safety-stop", timeoutMs: sec(30) },
      { t: "say", cap: "safety.stop", target: "safety-stop", ms: sec(6) },
      { t: "say", cap: "safety.diy", target: "diy-not-offered", ms: sec(5) },
    ],
  },
  {
    id: "proof",
    title: "Proof, giving and impact",
    steps: [
      { t: "nav", to: "$seededTechPath" },
      { t: "wait", target: "verified-repairs" },
      { t: "say", cap: "proof.profile", target: "verified-repairs", ms: sec(6) },
      { t: "say", cap: "proof.cv", target: "cv-button", ms: sec(4) },
      { t: "click", target: "nav-donate" },
      { t: "wait", target: "fund-total" },
      { t: "say", cap: "proof.donate", target: "fund-total", ms: sec(4) },
      { t: "say", cap: "proof.donateNote", target: "donate-tour-note", ms: sec(4), optional: true },
      { t: "click", target: "nav-impact" },
      { t: "wait", target: "impact-stats" },
      { t: "say", cap: "proof.impact", target: "impact-stats", ms: sec(7) },
    ],
  },
  {
    id: "turn",
    title: "Your turn",
    steps: [{ t: "end", cap: "turn.end" }],
  },
];

export const chaptersFor = (returnTo: ReturnTo): Chapter[] => (returnTo === "/signup" ? [ACCOUNTS_CHAPTER, ...BASE_CHAPTERS] : BASE_CHAPTERS);
/** Every chapter of every entry point (used by tests). */
export const CHAPTERS: Chapter[] = chaptersFor("/signup");

export const captionFor = (key: string): string => {
  const [group, name] = key.split(".");
  const value = (captionsJson as unknown as Record<string, Record<string, string | { text: string; narration?: string }>>)[group]?.[name];
  return typeof value === "string" ? value : value?.text ?? "";
};
export const uiText = (name: keyof typeof captionsJson.ui) => captionsJson.ui[name];
export const TOUR_TARGET_BAR = "tour-bar";
