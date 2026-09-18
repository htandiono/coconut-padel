import { randomBytes, scryptSync, timingSafeEqual, createHmac } from "node:crypto";

function getSecret() {
  return process.env.ADMIN_SECRET ?? process.env.AUTH_SECRET ?? "coconut-padel-dev-secret";
}

export function hashPin(pin: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(pin, salt, 32).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPin(pin: string, stored: string) {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const actual = scryptSync(pin, salt, 32);
  const expected = Buffer.from(hash, "hex");
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

export function signAdminToken(slug: string) {
  return createHmac("sha256", getSecret()).update(slug).digest("hex");
}

export function adminCookieName(slug: string) {
  return `coconut_admin_${slug}`;
}

export function isValidPin(pin: string) {
  return /^\d{4,6}$/.test(pin);
}
