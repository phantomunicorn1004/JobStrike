import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
function stateSecret(): string {
  return (
    process.env.AUTH_SECRET?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    ""
  );
}

function sign(payload: string): string {
  const secret = stateSecret();
  if (!secret) throw new Error("Cannot sign OAuth state: missing server secret.");
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createGoogleOAuthState(userId: string): string {
  const nonce = crypto.randomUUID();
  const payload = `${userId}.${nonce}`;
  const signature = sign(payload);
  return Buffer.from(`${payload}.${signature}`).toString("base64url");
}

export function verifyGoogleOAuthState(state: string): string {
  let decoded: string;
  try {
    decoded = Buffer.from(state, "base64url").toString("utf8");
  } catch {
    throw new Error("Invalid OAuth state.");
  }

  const lastDot = decoded.lastIndexOf(".");
  if (lastDot <= 0) throw new Error("Invalid OAuth state.");

  const payload = decoded.slice(0, lastDot);
  const signature = decoded.slice(lastDot + 1);
  const expected = sign(payload);

  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new Error("Invalid OAuth state signature.");
  }

  const userId = payload.split(".")[0];
  if (!userId) throw new Error("Invalid OAuth state user.");
  return userId;
}

export async function fetchGoogleEmailFromRefreshToken(
  refreshToken: string,
  origin: string,
): Promise<string | null> {
  const { google } = await import("googleapis");
  const { oauth2ClientWithRefreshToken } = await import(
    "@/lib/google-drive/oauth-web"
  );
  const oauth2 = oauth2ClientWithRefreshToken(refreshToken, origin);
  const { credentials } = await oauth2.refreshAccessToken();
  oauth2.setCredentials(credentials);
  const oauth2Api = google.oauth2({ version: "v2", auth: oauth2 });
  const { data } = await oauth2Api.userinfo.get();
  return data.email ?? null;
}
