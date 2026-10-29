/**
 * Starts a throwaway ReLoop dev server for recording: fresh seeded database (temp folder), PayPal credentials
 * blanked so everything is the labelled local simulation, scripted AI. Run: npm run record:server
 * Then, in another terminal: npm run record:demo
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const PORT = process.env.RECORD_PORT ?? "3300";
const root = process.cwd();
const bin = (p: string) => path.join(root, "node_modules", p);
// The database lives OUTSIDE the project: a sqlite file inside it makes the dev server hot-reload on every write.
const dbDir = mkdtempSync(path.join(os.tmpdir(), "reloop-record-"));
const env: NodeJS.ProcessEnv = {
  ...process.env,
  DATABASE_URL: `file:${path.join(dbDir, "record.db").replaceAll("\\", "/")}`,
  DEMO_MODE: "true",
  DEMO_ACTIONS: "true",
  PAYPAL_CLIENT_ID: "",
  PAYPAL_CLIENT_SECRET: "",
  NEXT_PUBLIC_PAYPAL_CLIENT_ID: "",
  PAYPAL_SIMULATE_APPROVAL: "false",
  ANTHROPIC_API_KEY: "",
  NEXT_PUBLIC_APP_URL: `http://localhost:${PORT}`,
};

process.on("exit", () => rmSync(dbDir, { recursive: true, force: true }));
const run = (args: string[]) => {
  const r = spawnSync(process.execPath, args, { cwd: root, env, stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
};
run([bin("prisma/build/index.js"), "migrate", "deploy"]);
run([bin("tsx/dist/cli.mjs"), "prisma/seed.ts"]);
console.log(`\nRecording server on http://localhost:${PORT} (fresh database, PayPal simulated). Ctrl+C to stop.\n`);
const server = spawn(process.execPath, [bin("next/dist/bin/next"), "dev", "-p", PORT], { cwd: root, env, stdio: "inherit" });
server.on("exit", (c) => process.exit(c ?? 0));
