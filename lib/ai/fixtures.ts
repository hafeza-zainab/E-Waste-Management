import type { Guide, ModelDiagnosis } from "./schemas";

/** Deterministic fixtures for the three scripted demo scenarios (no API key needed). */
export type ScenarioKey = "cracked-screen" | "swollen-battery" | "dead-tv";

export const SCENARIO_INTAKE: Record<
  ScenarioKey,
  { type: "phone" | "laptop" | "tv"; brand: string; model: string; ageYears: number; problem: string }
> = {
  "cracked-screen": {
    type: "phone",
    brand: "Samsung",
    model: "Galaxy A52",
    ageYears: 4,
    problem: "Screen cracked after a drop. Touch still works but the glass is splintering. Budget is $60.",
  },
  "swollen-battery": {
    type: "laptop",
    brand: "Dell",
    model: "Inspiron 15",
    ageYears: 5,
    problem: "Laptop base is bulging and the trackpad clicks stiffly. The battery looks swollen.",
  },
  "dead-tv": {
    type: "tv",
    brand: "Sony",
    model: "Bravia KDL-32",
    ageYears: 14,
    problem: "Old TV is completely dead. No standby light, no power, nothing happens when plugged in.",
  },
};

export const DIAGNOSIS_FIXTURES: Record<ScenarioKey, ModelDiagnosis> = {
  "cracked-screen": {
    summary: "The display glass is cracked but the phone otherwise works. A screen assembly swap is a standard, low-risk repair.",
    likely_causes: [
      { cause: "Impact damage to the front glass and display assembly", confidence: 0.94 },
      { cause: "Possible frame flex from the drop", confidence: 0.18 },
    ],
    severity: "minor",
    safety_risk: { level: "low", reasons: ["Splintering glass can cut fingers; handle with care."] },
    recommended_path: "technician",
    estimated_parts: [{ name: "Replacement display assembly (Galaxy A52)", price_usd: 39 }],
    estimated_labor: { hours: 0.75, cost_usd: 15 },
  },
  "swollen-battery": {
    summary: "A bulging base strongly suggests a swollen lithium-ion battery. It must not be opened, pressed or charged by an amateur.",
    likely_causes: [
      { cause: "Swollen lithium-ion battery pack (gas build-up from age and heat)", confidence: 0.91 },
      { cause: "Trackpad pushed up by the swollen battery", confidence: 0.72 },
    ],
    severity: "major",
    safety_risk: {
      level: "high",
      reasons: [
        "Swollen lithium battery can vent or ignite if punctured or charged.",
        "Do not charge the laptop; unplug it and keep it away from flammable items.",
      ],
    },
    // Deliberately wrong: simulates a model suggesting DIY so the demo shows the code-level safety gate overriding it.
    recommended_path: "diy",
    estimated_parts: [{ name: "Replacement battery pack (Inspiron 15)", price_usd: 42 }],
    estimated_labor: { hours: 1, cost_usd: 22 },
  },
  "dead-tv": {
    summary: "A 14-year-old TV with no standby light most likely has a failed power board. Repair would cost more than the set is worth.",
    likely_causes: [
      { cause: "Failed power supply board (blown capacitors or fuse)", confidence: 0.8 },
      { cause: "Failed main board", confidence: 0.25 },
    ],
    severity: "not_repairable",
    safety_risk: {
      level: "medium",
      reasons: ["Mains-powered internals hold charge in capacitors even when unplugged."],
    },
    recommended_path: "recycle",
    estimated_parts: [],
    estimated_labor: { hours: 0, cost_usd: 0 },
  },
};

/** Generic result used in demo mode for free-text cases that match no scripted scenario. */
export const GENERIC_FIXTURE: ModelDiagnosis = {
  summary: "Demo mode: this is a generic result. Set ANTHROPIC_API_KEY and DEMO_MODE=false for a real diagnosis of your description.",
  likely_causes: [
    { cause: "Worn consumable component (battery, connector or cable)", confidence: 0.6 },
    { cause: "Software or firmware fault", confidence: 0.3 },
  ],
  severity: "minor",
  safety_risk: { level: "low", reasons: ["Switch the device off and unplug it before inspecting."] },
  recommended_path: "technician",
  estimated_parts: [{ name: "Replacement component (generic estimate)", price_usd: 20 }],
  estimated_labor: { hours: 1, cost_usd: 18 },
};

export const GUIDE_FIXTURES: Record<"screen" | "generic", Guide> = {
  screen: {
    title: "Replace a cracked phone screen",
    estimated_minutes: 60,
    tools: ["Plastic opening picks", "Small Phillips screwdriver", "Hair dryer or heat gun (low)", "Tweezers", "Clear tape"],
    parts: ["Replacement display assembly matching your exact model", "Adhesive strips for the new screen"],
    steps: [
      { title: "Power off and protect the glass", instruction: "Turn the phone off, remove the SIM tray and cover the cracked glass with clear tape so splinters stay in place.", stop_and_book_if: "The phone is hot, swollen or the frame is bent." },
      { title: "Soften the adhesive", instruction: "Warm the edges of the screen with a hair dryer on low for 60 seconds. Do not overheat.", stop_and_book_if: "You see the back or battery bulging, or smell chemicals." },
      { title: "Lift the screen", instruction: "Slide a pick under a corner and work around the edge. Stop if you meet resistance rather than forcing it.", stop_and_book_if: "The screen will not lift without bending the frame or you cut into the battery area." },
      { title: "Disconnect the battery connector", instruction: "Unscrew the cover and disconnect the battery connector first, then the display cable.", stop_and_book_if: "A connector or the board looks damaged or liquid is present." },
      { title: "Fit and test the new display", instruction: "Connect the new display, power on to test touch and colour, then power off and press it into the adhesive.", stop_and_book_if: "The new screen shows lines, dead zones or the phone does not start." },
    ],
  },
  generic: {
    title: "Basic safe checks before repair",
    estimated_minutes: 30,
    tools: ["Soft cloth", "Known-good charger and cable", "Small screwdriver set"],
    parts: ["Replacement part as identified in the diagnosis"],
    steps: [
      { title: "Power off and unplug", instruction: "Switch the device off and disconnect all cables.", stop_and_book_if: "The device is hot, swollen, wet or smells burnt." },
      { title: "Check cables and ports", instruction: "Try a different cable or charger and gently clean ports with a dry soft brush.", stop_and_book_if: "A port is physically damaged or loose." },
      { title: "Restart and test", instruction: "Power on and test the fault again. Note any change.", stop_and_book_if: "The fault is unchanged or gets worse." },
    ],
  },
};
