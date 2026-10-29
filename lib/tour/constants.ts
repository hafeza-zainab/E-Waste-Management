/** Shared by server and client code. No imports, so the browser bundle stays small. */
export const TOUR_COOKIE = "reloop_tour";
/** Readable companion cookie: only says "a tour session may exist", so the next page load can clean up. Holds no id. */
export const TOUR_FLAG_COOKIE = "reloop_tour_on";
export const TOUR_MAX_AGE_MS = 2 * 60 * 60 * 1000;
