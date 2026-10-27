// All environmental and fund constants live here so judges can audit them in one place.
// NONE of these has a verified citation. Every figure is an "illustrative estimate":
// order-of-magnitude values chosen for a demo, NOT certified measurements. Replace them
// with sourced figures (e.g. from a published life-cycle assessment) before any real claim.

export type DeviceType = "phone" | "laptop" | "tablet" | "tv" | "appliance" | "other";

export const DEVICE_PROFILES: Record<DeviceType, { weightKg: number; embodiedCo2eKg: number }> = {
  phone: { weightKg: 0.2, embodiedCo2eKg: 70 },
  laptop: { weightKg: 2.0, embodiedCo2eKg: 300 },
  tablet: { weightKg: 0.5, embodiedCo2eKg: 100 },
  tv: { weightKg: 12, embodiedCo2eKg: 400 },
  appliance: { weightKg: 8, embodiedCo2eKg: 150 },
  other: { weightKg: 1, embodiedCo2eKg: 50 },
};

/** Share of a replacement device's manufacturing emissions avoided when the old one stays in use. */
export const REPLACEMENT_AVOIDED_FRACTION = 0.6;
/** Share of a recycled device's mass actually diverted from landfill by a certified recycler. */
export const RECYCLING_COLLECTION_RATE = 0.9;
/** Net kg CO2e saved per kg of e-waste properly recycled (material recovery vs virgin extraction). */
export const RECYCLING_CO2E_PER_KG = 1.5;

/** Recoverable materials (grams per kg of device) shown on the recycle path. */
export const RECOVERABLE_MATERIALS_G_PER_KG: Record<string, number> = {
  Copper: 60,
  Aluminium: 80,
  Steel: 200,
  "Plastics": 250,
  "Glass": 150,
  "Gold (trace)": 0.2,
};

/** Demo goal for the Refurbish & Donate Fund progress bar, in cents. */
export const FUND_GOAL_CENTS = 100_000; // $1,000
/**
 * Assumed subsidy needed to refurbish one device and keep it in use, in cents.
 * Certificate line "helps fund N devices kept in use" = floor(amountCents / this).
 */
export const REFURB_SUBSIDY_CENTS_PER_DEVICE = 2_500; // $25
/** Placeholder beneficiary. Not a real organisation. */
export const DEMO_BENEFICIARY = "Demo school refurbishing programme (placeholder, not a real organisation)";
/** Placeholder recycling partner. Not a real, certified recycler. */
export const DEMO_RECYCLER = "Demo Recycling Partner (placeholder, not a real certified recycler)";

export const SOURCE_NOTE = "illustrative estimate";

export interface ConstantDoc {
  name: string;
  value: string;
  meaning: string;
  source: string;
}

/** Rendered verbatim in the "How we calculate this" section of /impact. */
export const CONSTANT_DOCS: ConstantDoc[] = [
  ...Object.entries(DEVICE_PROFILES).flatMap(([type, p]) => [
    { name: `${type} weight`, value: `${p.weightKg} kg`, meaning: `Typical mass of a ${type}.`, source: SOURCE_NOTE },
    { name: `${type} embodied CO2e`, value: `${p.embodiedCo2eKg} kg`, meaning: `Emissions from manufacturing a new ${type}.`, source: SOURCE_NOTE },
  ]),
  { name: "REPLACEMENT_AVOIDED_FRACTION", value: String(REPLACEMENT_AVOIDED_FRACTION), meaning: "Share of a replacement's manufacturing CO2e avoided when the device stays in use (repair, refurbish, donate).", source: SOURCE_NOTE },
  { name: "RECYCLING_COLLECTION_RATE", value: String(RECYCLING_COLLECTION_RATE), meaning: "Share of a recycled device's mass diverted from landfill.", source: SOURCE_NOTE },
  { name: "RECYCLING_CO2E_PER_KG", value: `${RECYCLING_CO2E_PER_KG} kg CO2e/kg`, meaning: "Net CO2e saved per kg properly recycled.", source: SOURCE_NOTE },
  ...Object.entries(RECOVERABLE_MATERIALS_G_PER_KG).map(([m, g]) => ({ name: `${m} recoverable`, value: `${g} g per kg`, meaning: `Recoverable ${m.toLowerCase()} per kg of device.`, source: SOURCE_NOTE })),
  { name: "REFURB_SUBSIDY_CENTS_PER_DEVICE", value: "$25.00", meaning: "Assumed subsidy to refurbish one device; turns donated dollars into 'devices funded'.", source: SOURCE_NOTE },
  { name: "FUND_GOAL_CENTS", value: "$1,000.00", meaning: "Demo fundraising goal shown on the progress bar.", source: "demo placeholder" },
];
