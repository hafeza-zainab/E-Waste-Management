import { formatUsd } from "@/lib/jobs/money";
import type { DayPoint } from "@/lib/impact/totals";

/** Horizontal bars, plain SVG, with a real table as the text alternative. */
export function PathBarChart({ data }: { data: { label: string; value: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const row = 32;
  return (
    <figure>
      <svg role="img" aria-labelledby="bar-title bar-desc" viewBox={`0 0 400 ${data.length * row + 8}`} className="w-full max-w-lg">
        <title id="bar-title">Devices by outcome</title>
        <desc id="bar-desc">{data.map((d) => `${d.label}: ${d.value}`).join(", ")}</desc>
        {data.map((d, i) => (
          <g key={d.label} transform={`translate(0 ${i * row + 4})`}>
            <text x="0" y="18" fontSize="13" fill="currentColor">{d.label}</text>
            <rect x="90" y="4" width={Math.max(2, (d.value / max) * 260)} height="20" rx="4" fill="var(--color-primary, #0f766e)" />
            <text x={90 + Math.max(2, (d.value / max) * 260) + 6} y="19" fontSize="13" fill="currentColor">{d.value}</text>
          </g>
        ))}
      </svg>
      <figcaption className="sr-only">
        <table><caption>Devices by outcome</caption><tbody>{data.map((d) => <tr key={d.label}><th scope="row">{d.label}</th><td>{d.value}</td></tr>)}</tbody></table>
      </figcaption>
    </figure>
  );
}

/** Cumulative donations by day: vertical bars of each day's total. */
export function DonationsChart({ points }: { points: DayPoint[] }) {
  if (points.length === 0) return <p className="text-sm text-muted">No donations yet.</p>;
  const max = Math.max(1, ...points.map((p) => p.cents));
  const w = Math.max(24, Math.min(60, 360 / points.length));
  const width = points.length * (w + 8) + 8;
  return (
    <figure className="overflow-x-auto">
      <svg role="img" aria-labelledby="don-title don-desc" viewBox={`0 0 ${width} 170`} width={width} height="170">
        <title id="don-title">Donations per day</title>
        <desc id="don-desc">{points.map((p) => `${p.day}: ${formatUsd(p.cents)}`).join("; ")}</desc>
        {points.map((p, i) => {
          const h = Math.max(2, (p.cents / max) * 110);
          const x = 8 + i * (w + 8);
          return (
            <g key={p.day}>
              <rect x={x} y={130 - h} width={w} height={h} rx="3" fill="var(--color-primary, #0f766e)" />
              <text x={x + w / 2} y={125 - h} fontSize="10" textAnchor="middle" fill="currentColor">{formatUsd(p.cents)}</text>
              <text x={x + w / 2} y="146" fontSize="9" textAnchor="middle" fill="currentColor">{p.day.slice(5)}</text>
            </g>
          );
        })}
      </svg>
      <figcaption className="sr-only">
        <table><caption>Donations per day</caption><thead><tr><th>Day</th><th>That day</th><th>Running total</th></tr></thead>
          <tbody>{points.map((p) => <tr key={p.day}><th scope="row">{p.day}</th><td>{formatUsd(p.cents)}</td><td>{formatUsd(p.cumulativeCents)}</td></tr>)}</tbody></table>
      </figcaption>
    </figure>
  );
}
