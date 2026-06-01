import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import type { GoogleOAuthCredentials } from "@/lib/google-drive/oauth-web";

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

export function createGoogleOAuthState(userId: string, popup = false): string {
  const nonce = crypto.randomUUID();
  const popupFlag = popup ? "1" : "0";
  const payload = `${userId}.${nonce}.${popupFlag}`;
  const signature = sign(payload);
  return Buffer.from(`${payload}.${signature}`).toString("base64url");
}

export type VerifiedGoogleOAuthState = {
  userId: string;
  popup: boolean;
};

export function verifyGoogleOAuthState(state: string): VerifiedGoogleOAuthState {
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

  const parts = payload.split(".");
  const userId = parts[0];
  if (!userId) throw new Error("Invalid OAuth state user.");

  const popup = parts.length >= 3 && parts[2] === "1";
  return { userId, popup };
}

export async function fetchGoogleEmailFromRefreshToken(
  refreshToken: string,
  credentials: GoogleOAuthCredentials,
): Promise<string | null> {
  const { google } = await import("googleapis");
  const { oauth2ClientWithRefreshToken } = await import(
    "@/lib/google-drive/oauth-web"
  );
  const oauth2 = oauth2ClientWithRefreshToken(credentials, refreshToken);
  const { credentials: tokens } = await oauth2.refreshAccessToken();
  oauth2.setCredentials(tokens);
  const oauth2Api = google.oauth2({ version: "v2", auth: oauth2 });
  const { data } = await oauth2Api.userinfo.get();
  return data.email ?? null;
}

export function oauthPopupResultHtml(
  origin: string,
  result: { ok: boolean; reason?: string },
): string {
  const payload = JSON.stringify({
    type: "google-drive-oauth",
    ok: result.ok,
    reason: result.reason ?? null,
  });
  const safeOrigin = origin.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Google Drive</title></head>
<body>
<script>
  (function () {
    var payload = ${payload};
    if (window.opener) {
      window.opener.postMessage(payload, '${safeOrigin}');
      window.close();
      return;
    }
    var q = payload.ok ? 'connected' : 'error';
    var params = new URLSearchParams({ google: q });
    if (!payload.ok && payload.reason) params.set('reason', payload.reason);
    window.location.replace('/settings?' + params.toString());
  })();
</script>
<p>You can close this window.</p>
</body>
</html>`;
}
