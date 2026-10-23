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

/** Cookie holding the nonce of the connect flow this browser started (checked in the callback). */
export const GOOGLE_OAUTH_NONCE_COOKIE = "g_oauth_nonce";
/** How long a connect flow may take, from leaving JobStrike to coming back from Google. */
export const OAUTH_STATE_MAX_AGE_SEC = 10 * 60;

/**
 * Signed state for the Google consent screen: user, nonce, popup flag and issue time. The nonce
 * also goes into an httpOnly cookie, so the callback only accepts the flow this browser started,
 * within OAUTH_STATE_MAX_AGE_SEC, once.
 */
export function createGoogleOAuthState(userId: string, popup = false): { state: string; nonce: string } {
  const nonce = crypto.randomUUID();
  const popupFlag = popup ? "1" : "0";
  const payload = `${userId}.${nonce}.${popupFlag}.${Date.now()}`;
  const signature = sign(payload);
  return { state: Buffer.from(`${payload}.${signature}`).toString("base64url"), nonce };
}

export type VerifiedGoogleOAuthState = {
  userId: string;
  popup: boolean;
};

/** Reads the popup flag without trusting the state (to answer errors in the right way). */
export function peekGoogleOAuthPopup(state: string | null): boolean {
  try {
    return Buffer.from(state ?? "", "base64url").toString("utf8").split(".")[2] === "1";
  } catch {
    return false;
  }
}

export function verifyGoogleOAuthState(state: string, expectedNonce: string | null | undefined): VerifiedGoogleOAuthState {
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

  const [userId, nonce, popupFlag, issuedAt] = payload.split(".");
  if (!userId) throw new Error("Invalid OAuth state user.");
  const age = Date.now() - Number(issuedAt);
  if (!Number.isFinite(age) || age < 0 || age > OAUTH_STATE_MAX_AGE_SEC * 1000) {
    throw new Error("OAuth state expired.");
  }
  const n1 = Buffer.from(nonce ?? "");
  const n2 = Buffer.from(expectedNonce ?? "");
  if (!expectedNonce || n1.length !== n2.length || !timingSafeEqual(n1, n2)) {
    throw new Error("OAuth state was not started in this browser.");
  }

  return { userId, popup: popupFlag === "1" };
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
