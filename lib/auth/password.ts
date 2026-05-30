import { scrypt, randomBytes, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);
const KEY_LEN = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = (await scryptAsync(password, salt, KEY_LEN)) as Buffer;
  return `scrypt:${salt.toString("hex")}:${derived.toString("hex")}`;
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  try {
    if (!stored || typeof stored !== "string") return false;
    const parts = stored.split(":");
    if (parts.length !== 3 || parts[0] !== "scrypt") return false;
    const [, saltHex, hashHex] = parts;
    if (!saltHex || !hashHex) return false;
    const salt = Buffer.from(saltHex, "hex");
    const expected = Buffer.from(hashHex, "hex");
    if (expected.length === 0) return false;
    const derived = (await scryptAsync(password, salt, KEY_LEN)) as Buffer;
    if (derived.length !== expected.length) return false;
    return timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}
