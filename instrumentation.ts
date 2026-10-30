/** Runs once when the server starts. Logs which modes are active (never secrets) and enforces production safety. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { evaluateStartup } = await import("./lib/security/startup");
  const { log } = await import("./lib/log");
  const report = evaluateStartup(process.env);
  for (const [k, v] of Object.entries(report.forced)) process.env[k] = v;
  if (report.fatal.length) {
    for (const f of report.fatal) log.error("startup_refused", { message: f });
    throw new Error(`Refusing to start: ${report.fatal.join(" ")}`);
  }
  log.info("startup", { ...report.modes });
  for (const w of report.warnings) log.warn("startup_warning", { message: w });
  // Guest accounts live 24 hours: purge on start and then daily (also purged whenever a guest is created).
  const { purgeExpiredGuests } = await import("./lib/auth/accounts");
  const purge = () => purgeExpiredGuests().then((n) => n && log.info("guests_purged", { count: n }), () => {});
  void purge();
  setInterval(purge, 24 * 60 * 60 * 1000).unref();
}
