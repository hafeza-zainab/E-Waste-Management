/** Seeded parts catalogue (prices in integer cents). Also inserted by the phase6 migration so existing databases have it. */
export interface PartSeed {
  id: string;
  name: string;
  deviceType: string;
  models: string;
  quality: "oem" | "compatible" | "generic";
  priceCents: number;
  stock: number;
}

export const PARTS: PartSeed[] = [
  { id: "part-a52-screen-oem", name: "Display assembly, OEM (Galaxy A52)", deviceType: "phone", models: "galaxy a52", quality: "oem", priceCents: 5400, stock: 3 },
  { id: "part-a52-screen-compat", name: "Display assembly, compatible aftermarket (Galaxy A52)", deviceType: "phone", models: "galaxy a52", quality: "compatible", priceCents: 3400, stock: 8 },
  { id: "part-a52-battery", name: "Battery, compatible (Galaxy A52)", deviceType: "phone", models: "galaxy a52", quality: "compatible", priceCents: 2200, stock: 6 },
  { id: "part-inspiron15-battery-oem", name: "Battery pack, OEM (Inspiron 15)", deviceType: "laptop", models: "inspiron 15", quality: "oem", priceCents: 4500, stock: 2 },
  { id: "part-bravia-psu", name: "Power supply board (Bravia KDL-32)", deviceType: "tv", models: "bravia kdl-32", quality: "oem", priceCents: 3800, stock: 0 },
  { id: "part-phone-usbc-flex", name: "USB-C charging port flex, universal", deviceType: "phone", models: "*", quality: "generic", priceCents: 1200, stock: 20 },
  { id: "part-phone-screen-protector", name: "Tempered glass protector, universal", deviceType: "phone", models: "*", quality: "generic", priceCents: 600, stock: 50 },
  { id: "part-laptop-ssd", name: "SSD 256 GB, universal 2.5 inch", deviceType: "laptop", models: "*", quality: "generic", priceCents: 2800, stock: 9 },
  { id: "part-tablet-battery", name: "Tablet battery, universal", deviceType: "tablet", models: "*", quality: "generic", priceCents: 2400, stock: 7 },
];
