import {
  DEVICE_PROFILES,
  RECYCLING_COLLECTION_RATE,
  RECYCLING_CO2E_PER_KG,
  REPLACEMENT_AVOIDED_FRACTION,
  RECOVERABLE_MATERIALS_G_PER_KG,
  type DeviceType,
} from "./constants";

export type Outcome = "repair" | "refurbish" | "donate" | "recycle";

export interface ImpactResult {
  ewasteKg: number;
  co2eKg: number;
}

const round = (n: number) => Math.round(n * 100) / 100;

export function isDeviceType(v: string): v is DeviceType {
  return v in DEVICE_PROFILES;
}

/**
 * Keeping a device in use (repair / refurbish / donate) avoids its whole mass as
 * e-waste and a fraction of a replacement's manufacturing emissions.
 * Recycling diverts a share of the mass from landfill and recovers materials.
 */
export function computeImpact(deviceType: string, outcome: Outcome): ImpactResult {
  const profile = DEVICE_PROFILES[isDeviceType(deviceType) ? deviceType : "other"];
  if (outcome === "recycle") {
    const ewasteKg = profile.weightKg * RECYCLING_COLLECTION_RATE;
    return { ewasteKg: round(ewasteKg), co2eKg: round(ewasteKg * RECYCLING_CO2E_PER_KG) };
  }
  return {
    ewasteKg: round(profile.weightKg),
    co2eKg: round(profile.embodiedCo2eKg * REPLACEMENT_AVOIDED_FRACTION),
  };
}

export function recoverableMaterials(deviceType: string): { material: string; grams: number }[] {
  const kg = DEVICE_PROFILES[isDeviceType(deviceType) ? deviceType : "other"].weightKg;
  return Object.entries(RECOVERABLE_MATERIALS_G_PER_KG).map(([material, perKg]) => ({
    material,
    grams: Math.round(perKg * kg * 10) / 10,
  }));
}
