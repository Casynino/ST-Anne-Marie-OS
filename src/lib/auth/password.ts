import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

// OWASP-recommended scrypt profile (N=2^15, r=8, p=3 ≈ 32 MB). Parameters are stored with
// each hash so they can be raised later without invalidating existing passwords.
const DEFAULTS = { N: 32768, r: 8, p: 3 };
const KEY_LEN = 32;
const MAXMEM = 128 * 1024 * 1024;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const { N, r, p } = DEFAULTS;
  const key = await scrypt(password, salt, KEY_LEN, { N, r, p, maxmem: MAXMEM });
  return ["scrypt", N, r, p, salt.toString("base64"), key.toString("base64")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, saltB64, keyB64] = stored.split("$");
  if (alg !== "scrypt" || !n || !r || !p || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, "base64");
  const actual = await scrypt(password, Buffer.from(saltB64, "base64"), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: MAXMEM,
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Used to keep response time similar when the account does not exist. */
export const DUMMY_HASH =
  "scrypt$32768$8$3$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

export function validatePasswordStrength(password: string): string | null {
  if (password.length < 10) return "Password must be at least 10 characters.";
  if (password.length > 128) return "Password is too long (maximum 128 characters).";
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return "Password must contain letters and numbers.";
  return null;
}

/** Random temporary password (no ambiguous characters) shown once to the admin who creates/resets an account. */
export function generateTemporaryPassword(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(12);
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return `${out}7`; // guarantees at least one digit
}
