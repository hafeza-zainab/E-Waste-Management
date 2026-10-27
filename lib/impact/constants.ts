// All environmental constants live here so judges can audit them in one place.
// These are rough, illustrative estimates (order-of-magnitude figures drawn from
// public lifecycle-assessment literature), NOT certified measurements.

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
