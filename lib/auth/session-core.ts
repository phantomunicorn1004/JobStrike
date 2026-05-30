import type { SessionPayload, SessionUser } from "@/lib/auth/types";
import { SESSION_MAX_AGE_SEC } from "@/lib/auth/constants";

/** Session signing key — derived from existing Supabase service role key (no AUTH_SECRET env needed). */
function getAuthSecret(): string {
  const override = process.env.AUTH_SECRET?.trim();
  if (override) return override;

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (serviceKey) {
    return `rwh-session-v1:${serviceKey}`;
  }

  if (process.env.NODE_ENV !== "production") {
    return "rwh-dev-insecure-session-secret";
  }

  throw new Error(
    "Missing SUPABASE_SERVICE_ROLE_KEY. User authentication requires the service role key.",
  );
}

function encodeBase64Url(data: Uint8Array): string {
  let binary = "";
  for (const byte of data) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  const binary = atob(padded + pad);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function signSessionToken(user: SessionUser): Promise<string> {
  const payload: SessionPayload = {
    ...user,
    exp: Date.now() + SESSION_MAX_AGE_SEC * 1000,
  };
  const body = encodeBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await importHmacKey(getAuthSecret());
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return `${body}.${encodeBase64Url(new Uint8Array(sig))}`;
}

export async function verifySessionToken(token: string): Promise<SessionUser | null> {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  try {
    const key = await importHmacKey(getAuthSecret());
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      decodeBase64Url(sig) as BufferSource,
      new TextEncoder().encode(body),
    );
    if (!valid) return null;
    const json = new TextDecoder().decode(decodeBase64Url(body));
    const payload = JSON.parse(json) as SessionPayload;
    if (!payload?.id || !payload?.username || !payload?.role) return null;
    if (typeof payload.exp !== "number" || payload.exp < Date.now()) return null;
    return { id: payload.id, username: payload.username, role: payload.role };
  } catch {
    return null;
  }
}
