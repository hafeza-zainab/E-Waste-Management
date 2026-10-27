import { z } from "zod";
import { splitPayout } from "./money";

export interface TechCandidate {
  id: string;
  name: string;
  skills: string; // comma separated
  rating: number;
  distanceKm: number;
  hourlyCents: number;
  isTrainee: boolean;
}

export const QuoteLineSchema = z.object({
  kind: z.enum(["part", "labor", "logistics"]),
  label: z.string(),
  cents: z.number().int().min(0),
});

export const QuoteSchema = z.object({
  technicianId: z.string(),
  technicianName: z.string(),
  matchReasons: z.array(z.string()),
  pickup: z.boolean(),
  lines: z.array(QuoteLineSchema),
  partsCents: z.number().int(),
  laborCents: z.number().int(),
  logisticsCents: z.number().int(),
  totalCents: z.number().int(),
  platformFeeCents: z.number().int(),
  technicianPayoutCents: z.number().int(),
});
export type Quote = z.infer<typeof QuoteSchema>;

/** Flat pickup/delivery fee plus a per-km charge. Documented constants, not model output. */
export const PICKUP_BASE_CENTS = 400;
export const PICKUP_PER_KM_CENTS = 40;

export interface Match {
  tech: TechCandidate;
  score: number;
  reasons: string[];
}

/** Rank technicians who list the device type as a skill. Higher rating, closer and cheaper wins. */
export function rankTechnicians(deviceType: string, techs: TechCandidate[]): Match[] {
  return techs
    .filter((t) => t.skills.split(",").map((s) => s.trim()).includes(deviceType))
    .map((t) => ({
      tech: t,
      score: t.rating * 10 - t.distanceKm * 1.5 - t.hourlyCents / 500,
      reasons: [
        `Repairs ${deviceType}s`,
        `Rated ${t.rating.toFixed(1)}`,
        `${t.distanceKm.toFixed(1)} km away`,
        ...(t.isTrainee ? ["Trainee rate, supervised"] : []),
      ],
    }))
    .sort((a, b) => b.score - a.score || a.tech.id.localeCompare(b.tech.id));
}

export function matchTechnician(deviceType: string, techs: TechCandidate[]): Match | null {
  return rankTechnicians(deviceType, techs)[0] ?? null;
}

export interface QuoteInput {
  deviceType: string;
  parts: { name: string; price_usd: number }[];
  laborHours: number;
  pickup: boolean;
  technicians: TechCandidate[];
  /** Force a specific technician (agent or user choice). */
  technicianId?: string;
}

/** Deterministic itemised quote. Throws when no technician can repair this device type. */
export function buildQuote(input: QuoteInput): Quote {
  const ranked = rankTechnicians(input.deviceType, input.technicians);
  const match = input.technicianId ? ranked.find((m) => m.tech.id === input.technicianId) : ranked[0];
  if (!match) throw new Error(`No technician available for ${input.deviceType}`);

  const hours = Math.max(0.5, Math.round(input.laborHours * 4) / 4);
  const lines: Quote["lines"] = [
    ...input.parts.map((p) => ({ kind: "part" as const, label: p.name, cents: Math.round(p.price_usd * 100) })),
    {
      kind: "labor",
      label: `Labor, ${hours} h at $${(match.tech.hourlyCents / 100).toFixed(2)}/h`,
      cents: Math.round(match.tech.hourlyCents * hours),
    },
  ];
  if (input.pickup) {
    lines.push({
      kind: "logistics",
      label: `Pickup and delivery (${match.tech.distanceKm.toFixed(1)} km)`,
      cents: PICKUP_BASE_CENTS + Math.round(match.tech.distanceKm * PICKUP_PER_KM_CENTS),
    });
  }
  const sum = (k: Quote["lines"][number]["kind"]) => lines.filter((l) => l.kind === k).reduce((s, l) => s + l.cents, 0);
  const totalCents = lines.reduce((s, l) => s + l.cents, 0);
  const split = splitPayout(totalCents);
  return QuoteSchema.parse({
    technicianId: match.tech.id,
    technicianName: match.tech.name,
    matchReasons: match.reasons,
    pickup: input.pickup,
    lines,
    partsCents: sum("part"),
    laborCents: sum("labor"),
    logisticsCents: sum("logistics"),
    totalCents,
    platformFeeCents: split.platformFeeCents,
    technicianPayoutCents: split.technicianCents,
  });
}
