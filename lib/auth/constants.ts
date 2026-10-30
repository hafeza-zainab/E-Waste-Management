/** Shared by server and client code. No imports. */
export const SESSION_COOKIE = "reloop_session";
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** The DB expiry slides at most this often (avoids a write on every request). */
export const SESSION_TOUCH_MS = 60 * 60 * 1000;
export const GUEST_TTL_MS = 24 * 60 * 60 * 1000;
/** Tour-only identity overlay; see lib/tour/server.ts. Never read or written by the real session code. */
export const TOUR_ROLE_COOKIE = "reloop_tour_role";
export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;
export const DEMO_OWNER_EMAIL = "owner@reloop.demo";
export const DEMO_TECH_EMAIL = "tech@reloop.demo";
/** Marker that is never a valid hash: the account has no usable password. */
export const NO_PASSWORD = "!";
/** Printed in the README. Public by design: the demo accounts hold demo data only. Override with DEMO_ACCOUNT_PASSWORD. */
export const DEFAULT_DEMO_PASSWORD = "reloop-demo-2026";
export const DEMO_TECH_NAME = "Aisha Rahman";
