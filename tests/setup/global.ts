import { execSync } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";

/** Builds a throwaway SQLite database (prisma/test.db) from the real migrations for the lifecycle tests. */
export default function setup() {
  const file = path.join(process.cwd(), "prisma", "test.db");
  rmSync(file, { force: true });
  execSync("npx prisma migrate deploy", { stdio: "pipe", env: { ...process.env, DATABASE_URL: "file:./test.db" } });
  return () => rmSync(file, { force: true });
}
