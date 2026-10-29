/**
 * Submission readiness check. Run: npm run prelaunch
 * Exits non-zero when any FAIL is found. WARN items never fail the run.
 * Config (env): PRELAUNCH_DEVPOST_MAX_CHARS (default 6000), HOSTED_URL (overrides the URL parsed from the README).
 * Scans README.md and the submission-facing docs. docs/deploy.md and docs/recording.md are how-to guides with
 * deliberate <placeholders>, so they are skipped for the placeholder check.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (f: string) => (existsSync(path.join(root, f)) ? readFileSync(path.join(root, f), "utf8") : null);
const lines = (f: string) => (read(f) ?? "").split(/\r?\n/);
const DEVPOST_MAX = Number(process.env.PRELAUNCH_DEVPOST_MAX_CHARS ?? 6000);

type Level = "FAIL" | "WARN" | "PASS";
interface Row { check: string; level: Level; details: string[] }
const rows: Row[] = [];
const add = (check: string, level: Level, details: string[] = []) => rows.push({ check, level, details });
const verdict = (check: string, problems: string[], level: Level = "FAIL") => add(check, problems.length ? level : "PASS", problems);

const git = (...a: string[]) => { try { return execFileSync("git", a, { cwd: root, encoding: "utf8" }).split(/\r?\n/).filter(Boolean); } catch { return null; } };

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(path.join(root, dir))) return out;
  for (const n of readdirSync(path.join(root, dir))) {
    if (n === "node_modules" || n === ".next" || n.startsWith(".")) continue;
    const rel = `${dir}/${n}`;
    if (statSync(path.join(root, rel)).isDirectory()) walk(rel, out);
    else if (/\.(ts|tsx|mjs|js)$/.test(n)) out.push(rel);
  }
  return out;
}

async function main() {
  // 1. Placeholders ---------------------------------------------------------------------------------------
  const docs = ["README.md", ...readdirSync(path.join(root, "docs")).filter((f) => f.endsWith(".md") && !["deploy.md", "recording.md"].includes(f)).map((f) => `docs/${f}`)];
  const placeholder = /\bTODO\b|YOUR_[A-Z_]+|CHANGEME|<(?:url|repo|repo-url|your-[^>]*|fill in[^>]*|sandbox buyer[^>]*|link[^>]*)>/i;
  const ph: string[] = [];
  for (const f of docs) lines(f).forEach((l, i) => { if (placeholder.test(l)) ph.push(`${f}:${i + 1}  ${l.trim().slice(0, 90)}`); });
  // Empty "Password:" / "Hosted demo:" values (nothing after the colon).
  for (const f of docs) lines(f).forEach((l, i) => { if (/^\W*(password|hosted (demo|url)|live (demo|url)|demo video)\W*:\W*$/i.test(l.trim())) ph.push(`${f}:${i + 1}  empty value: ${l.trim()}`); });
  verdict("No placeholders in README/docs (TODO, YOUR_, <url>, <repo>, CHANGEME, empty URL/password)", ph);

  // 2. License --------------------------------------------------------------------------------------------
  const lic = read("LICENSE");
  verdict("LICENSE exists and is MIT", !lic ? ["LICENSE is missing"] : /^\s*MIT License/i.test(lic) && /Permission is hereby granted, free of charge/.test(lic) ? [] : ["LICENSE:1  does not look like the MIT license text"]);

  // 3. .env.example covers every variable the code reads ---------------------------------------------------
  const example = read(".env.example");
  const sourceFiles = [...walk("app"), ...walk("lib"), ...walk("components"), ...walk("prisma"), "proxy.ts", "instrumentation.ts", "next.config.ts"].filter((f) => existsSync(path.join(root, f)));
  const platformVars = new Set(["NODE_ENV", "NEXT_RUNTIME", "RENDER_EXTERNAL_URL", "PORT", "NEXT_PHASE", "CI"]);
  const used = new Map<string, string>();
  for (const f of sourceFiles) lines(f).forEach((l, i) => { for (const m of l.matchAll(/process\.env\.([A-Z][A-Z0-9_]+)/g)) if (!platformVars.has(m[1]) && !used.has(m[1])) used.set(m[1], `${f}:${i + 1}`); });
  const declared = new Set((example ?? "").split(/\r?\n/).map((l) => /^#?\s*([A-Z][A-Z0-9_]+)=/.exec(l)?.[1]).filter(Boolean) as string[]);
  verdict(".env.example lists every variable the code reads", !example ? [".env.example is missing"] : [...used].filter(([k]) => !declared.has(k)).map(([k, w]) => `${k} is read at ${w} but is not in .env.example`));

  // 4. Nothing sensitive tracked -----------------------------------------------------------------------------
  const tracked = git("ls-files");
  verdict("No .env, *.db or uploads tracked by git", !tracked ? ["could not run git ls-files"] : tracked.filter((f) => /(^|\/)\.env(?!\.example$)[^/]*$/.test(f) || /\.db(-journal)?$/.test(f) || (/^public\/uploads\//.test(f) && !f.endsWith(".gitkeep")) || /^docs\/clips\/.+\.(webm|mp4)$/.test(f)).map((f) => `${f} is tracked by git`));

  // 5. Screenshots referenced by the README exist ---------------------------------------------------------------
  const shots: string[] = [];
  lines("README.md").forEach((l, i) => { for (const m of l.matchAll(/(?:\]\(|src=")(docs\/screenshots\/[^)"\s]+)/g)) if (!existsSync(path.join(root, m[1]))) shots.push(`README.md:${i + 1}  missing ${m[1]}`); });
  verdict("Every docs/screenshots file referenced by the README exists", shots);

  // 6. README sections --------------------------------------------------------------------------------------------
  const headings = lines("README.md").filter((l) => /^#{1,3}\s/.test(l)).map((l) => l.toLowerCase());
  const need: [string, RegExp][] = [["problem", /problem/], ["how PayPal is used", /paypal/], ["how AI is used", /\bai\b|claude/], ["run instructions", /\brun\b|install|getting started|setup/], ["limitations", /limitation/], ["license", /licen[cs]e/]];
  verdict("README has the required sections", need.filter(([, re]) => !headings.some((h) => re.test(h))).map(([n]) => `README.md  no heading for: ${n}`));

  // 7. Devpost description ------------------------------------------------------------------------------------------
  const dp = read("docs/devpost-description.md");
  const dpProblems: string[] = [];
  if (!dp) dpProblems.push("docs/devpost-description.md is missing");
  else {
    if (dp.length > DEVPOST_MAX) dpProblems.push(`docs/devpost-description.md  ${dp.length} characters, limit ${DEVPOST_MAX} (set PRELAUNCH_DEVPOST_MAX_CHARS to change)`);
    const h = lines("docs/devpost-description.md").filter((l) => /^#{1,3}\s/.test(l)).join("\n").toLowerCase();
    for (const [n, re] of [["Inspiration", /inspiration/], ["What it does", /what it does/], ["How we built it", /how we built/], ["Challenges", /challenges/], ["Accomplishments", /accomplishments/], ["What we learned", /what we learned/], ["What's next", /what'?s next/]] as [string, RegExp][]) if (!re.test(h)) dpProblems.push(`docs/devpost-description.md  missing section: ${n}`);
  }
  verdict("Devpost description has its sections and fits the length limit", dpProblems);

  // 8. console.log of obvious secrets --------------------------------------------------------------------------------
  const leaks: string[] = [];
  const scanFiles = [...sourceFiles, ...walk("scripts")];
  for (const f of scanFiles) lines(f).forEach((l, i) => {
    if (!/console\.(log|info|debug|warn|error)\(|log\.(info|warn|error|debug)\(/.test(l)) return;
    const code = l.replace(/\$\{([^}]*)\}/g, " $1 ").replace(/`[^`]*`/g, (m) => m).replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""').replace(/`([^`$]|\$(?!\{))*`/g, '""');
    if (/process\.env\.\w*(SECRET|API_KEY|TOKEN|PASSWORD)\w*|\b(client_?secret|secret|apiKey|api_key|accessToken|access_token|password)\b/i.test(code)) leaks.push(`${f}:${i + 1}  ${l.trim().slice(0, 100)}`);
  });
  verdict("No console/log call prints an obvious secret", leaks);

  // ---- warnings ----------------------------------------------------------------------------------------------------------
  const readme = read("README.md") ?? "";
  add("Demo video link is in the README", /youtu\.?be|vimeo|loom\.com|\.mp4|demo video/i.test(readme) && /https?:\/\/\S*(youtu|vimeo|loom|\.mp4)/i.test(readme) ? "PASS" : "WARN", /https?:\/\/\S*(youtu|vimeo|loom|\.mp4)/i.test(readme) ? [] : ["README.md  no video URL found (YouTube, Vimeo, Loom or .mp4)"]);

  const hosted = process.env.HOSTED_URL || /(?:hosted|live)[^\n]*?(https:\/\/[^\s)`>*<]+)/i.exec(readme)?.[1];
  if (!hosted || /<|your-service/.test(hosted)) add("Hosted URL responds", "WARN", ["no real hosted URL set in the README (or HOSTED_URL); skipped"]);
  else {
    try {
      const r = await fetch(hosted, { method: "HEAD", signal: AbortSignal.timeout(15000), redirect: "follow" });
      add("Hosted URL responds", r.ok ? "PASS" : "WARN", r.ok ? [] : [`${hosted} answered HTTP ${r.status}`]);
    } catch (e) {
      add("Hosted URL responds", "WARN", [`${hosted} did not answer in 15 s (${e instanceof Error ? e.message : e}). A sleeping free host may need a minute.`]);
    }
  }
  const webhookDoc = declared.has("PAYPAL_WEBHOOK_ID") && /PAYPAL_WEBHOOK_ID/.test(`${readme}${read("docs/deploy.md") ?? ""}`);
  add("PAYPAL_WEBHOOK_ID is documented", webhookDoc ? "PASS" : "WARN", webhookDoc ? [] : [".env.example or README/docs/deploy.md does not mention PAYPAL_WEBHOOK_ID"]);

  // ---- report -------------------------------------------------------------------------------------------------------------
  const w = Math.max(...rows.map((r) => r.check.length));
  console.log("\nprelaunch\n");
  for (const r of rows) console.log(`${r.level.padEnd(5)} ${r.check.padEnd(w)}`);
  for (const r of rows.filter((x) => x.level !== "PASS")) {
    console.log(`\n${r.level}: ${r.check}`);
    r.details.forEach((d) => console.log(`  ${d}`));
  }
  const fails = rows.filter((r) => r.level === "FAIL").length;
  const warns = rows.filter((r) => r.level === "WARN").length;
  console.log(`\n${rows.filter((r) => r.level === "PASS").length} passed, ${fails} failed, ${warns} warnings`);
  process.exitCode = fails ? 1 : 0;
}

main().catch((e) => { console.error(e); process.exit(2); });
