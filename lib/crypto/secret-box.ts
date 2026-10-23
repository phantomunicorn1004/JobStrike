import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Encrypts secrets at rest (OAuth refresh tokens, client secrets) with AES-256-GCM.
 *
 * Key: TOKEN_ENCRYPTION_KEY = 32 random bytes, base64 (e.g. `openssl rand -base64 32`).
 * Stored format: "v1:<iv>:<auth tag>:<ciphertext>" (base64 parts); the version prefix allows a
 * later key rotation. Values without the prefix are older plain-text values: they are returned as
 * they are, and get encrypted the next time they are saved.
 */
const VERSION = "v1";

function encryptionKey(): Buffer | null {
  const raw = process.env.TOKEN_ENCRYPTION_KEY?.trim();
  if (!raw) return null;
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("TOKEN_ENCRYPTION_KEY must be 32 bytes, base64-encoded (openssl rand -base64 32).");
  }
  return key;
}

export function isSecretEncryptionConfigured(): boolean {
  return encryptionKey() !== null;
}

export function isEncryptedSecret(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(`${VERSION}:`);
}

/** Encrypts <paramref name="plain"/>. Throws when no key is configured (use for new secrets). */
export function encryptSecret(plain: string): string {
  const key = encryptionKey();
  if (!key) throw new Error("TOKEN_ENCRYPTION_KEY is not set, so secrets cannot be stored.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64"), cipher.getAuthTag().toString("base64"), ciphertext.toString("base64")].join(":");
}

/**
 * Encrypts when a key is configured, otherwise keeps the value as it is (for existing features
 * such as Google Drive, which must keep working until the key is set).
 */
export function encryptSecretIfConfigured(plain: string): string {
  return isSecretEncryptionConfigured() ? encryptSecret(plain) : plain;
}

/** Decrypts a stored value; older plain-text values are returned unchanged. */
export function decryptSecret(stored: string): string {
  if (!isEncryptedSecret(stored)) return stored;
  const key = encryptionKey();
  if (!key) throw new Error("TOKEN_ENCRYPTION_KEY is not set, so a stored secret cannot be read.");
  const [, iv, tag, ciphertext] = stored.split(":");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64")), decipher.final()]).toString("utf8");
}
