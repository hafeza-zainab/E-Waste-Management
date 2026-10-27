/** Runs once when the server starts. Logs which modes are active (never secrets) and enforces production safety. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { evaluateStartup } = await import("./lib/security/startup");
  const { log } = await import("./lib/log");
  const report = evaluateStartup(process.env);
  for (const [k, v] of Object.entries(report.forced)) process.env[k] = v;
  log.info("startup", { ...report.modes });
  for (const w of report.warnings) log.warn("startup_warning", { message: w });
}
