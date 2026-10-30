import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";
import { NO_PASSWORD, PASSWORD_MAX, PASSWORD_MIN } from "./constants";

/** scrypt with a per-user random salt. The parameters travel with the hash, so they can be raised later. */
const PARAMS = { N: 16384, r: 8, p: 1, keyLen: 64 } as const;
const MAX_N = 1 << 17; // a stored hash can never make us allocate more than this
const scrypt = (pw: string, salt: Buffer, keyLen: number, o: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) => scryptCb(pw, salt, keyLen, o, (e, k) => (e ? reject(e) : resolve(k))));
const opts = (N: number, r: number, p: number): ScryptOptions => ({ N, r, p, maxmem: 160 * N * r });

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password.normalize("NFKC"), salt, PARAMS.keyLen, opts(PARAMS.N, PARAMS.r, PARAMS.p));
  return ["scrypt", PARAMS.N, PARAMS.r, PARAMS.p, salt.toString("base64url"), key.toString("base64url")].join("$");
}

// A real hash of a random value, so "no such account" costs the same as "wrong password".
let dummy: Promise<string> | null = null;
const dummyHash = () => (dummy ??= hashPassword(randomBytes(12).toString("hex")));

/** Constant-time compare. A missing or unusable hash still runs a full scrypt so timing does not reveal why it failed. */
export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  const usable = !!stored && stored !== NO_PASSWORD && stored.startsWith("scrypt$");
  const [, n, r, p, salt, hash] = (usable ? stored! : await dummyHash()).split("$");
  const N = Number(n), R = Number(r), P = Number(p);
  if (!Number.isInteger(N) || !Number.isInteger(R) || !Number.isInteger(P) || N < 2 || N > MAX_N || (N & (N - 1)) !== 0 || R < 1 || R > 16 || P < 1 || P > 4 || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const actual = await scrypt(password.normalize("NFKC"), Buffer.from(salt, "base64url"), expected.length, opts(N, R, P));
  const same = actual.length === expected.length && timingSafeEqual(actual, expected);
  return usable && same;
}

/** Returns a friendly message, or null when the password is acceptable. */
export function passwordProblem(password: string, ctx: { email?: string; name?: string } = {}): string | null {
  if (password.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`;
  if (password.length > PASSWORD_MAX) return `Use at most ${PASSWORD_MAX} characters.`;
  const lower = password.trim().toLowerCase();
  if (ctx.email && lower === ctx.email.trim().toLowerCase()) return "The password can't be the same as your email.";
  if (ctx.name && lower === ctx.name.trim().toLowerCase()) return "The password can't be the same as your name.";
  return null;
}
