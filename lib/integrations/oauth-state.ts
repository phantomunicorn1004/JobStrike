import "server-only";

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import {
  MAIL_OAUTH_MESSAGE,
  type MailOAuthResult,
  type MailProvider,
} from "@/lib/integrations/types";

/**
 * State for the mailbox connect flow (docs/EMAIL_CALENDAR_INTEGRATION.md, section 1.5).
 *
 * The flow lives in one signed, httpOnly cookie: who started it, for which provider and profile,
 * the random `state` sent to the provider and the PKCE code verifier. The callback accepts only
 * the flow this browser started, for the signed-in user who started it, within 10 minutes, and
 * clears the cookie so it can be used once.
 */
const COOKIE_NAME = "mail_oauth";
const COOKIE_PATH = "/api/integrations/mail";
const MAX_AGE_SEC = 10 * 60;

export type MailOAuthFlow = {
  provider: MailProvider;
  userId: string;
  profileId: number | null;
  state: string;
  codeVerifier: string;
  issuedAt: number;
};

function signingSecret(): string {
  const secret = process.env.AUTH_SECRET?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!secret) throw new Error("Cannot sign the connect request: AUTH_SECRET is not set.");
  return secret;
}

function sign(payload: string): string {
  return createHmac("sha256", signingSecret()).update(payload).digest("base64url");
}

function sameText(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Starts a flow: returns the state and PKCE challenge for the provider, and the cookie to set. */
export function createMailOAuthFlow(input: {
  provider: MailProvider;
  userId: string;
  profileId: number | null;
}): { state: string; codeChallenge: string; cookieValue: string } {
  const flow: MailOAuthFlow = {
    ...input,
    state: randomBytes(24).toString("base64url"),
    codeVerifier: randomBytes(48).toString("base64url"),
    issuedAt: Date.now(),
  };
  const payload = Buffer.from(JSON.stringify(flow)).toString("base64url");
  return {
    state: flow.state,
    codeChallenge: createHash("sha256").update(flow.codeVerifier).digest("base64url"),
    cookieValue: `${payload}.${sign(payload)}`,
  };
}

export function setMailOAuthCookie(response: NextResponse, cookieValue: string) {
  response.cookies.set(COOKIE_NAME, cookieValue, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: COOKIE_PATH,
    maxAge: MAX_AGE_SEC,
  });
}

export function clearMailOAuthCookie(response: NextResponse) {
  response.cookies.set(COOKIE_NAME, "", { path: COOKIE_PATH, maxAge: 0 });
}

/** Checks the callback against the cookie. Throws when it is not the flow this browser started. */
export function readMailOAuthFlow(
  request: NextRequest,
  provider: MailProvider,
  state: string | null,
): MailOAuthFlow {
  const cookie = request.cookies.get(COOKIE_NAME)?.value ?? "";
  const dot = cookie.lastIndexOf(".");
  if (dot <= 0) throw new Error("No connect request was started in this browser.");

  const payload = cookie.slice(0, dot);
  if (!sameText(cookie.slice(dot + 1), sign(payload))) {
    throw new Error("The connect request was changed.");
  }

  const flow = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as MailOAuthFlow;
  const age = Date.now() - flow.issuedAt;
  if (!Number.isFinite(age) || age < 0 || age > MAX_AGE_SEC * 1000) {
    throw new Error("The connect request expired.");
  }
  if (flow.provider !== provider) throw new Error("The connect request was for another provider.");
  if (!state || !sameText(state, flow.state)) throw new Error("The connect request does not match.");
  return flow;
}

/**
 * The page the provider sends the browser back to. In the popup it tells the Settings page the
 * result and closes; opened without a popup it goes back to Settings.
 */
export function mailOAuthResultResponse(
  request: NextRequest,
  result: { ok: boolean; message?: string | null; email?: string | null },
): NextResponse {
  const origin = new URL(request.url).origin;
  const payload: MailOAuthResult = {
    type: MAIL_OAUTH_MESSAGE,
    ok: result.ok,
    message: result.message ?? null,
    email: result.email ?? null,
  };
  // JSON inside a <script>: escape "<" so a message can never close the tag.
  const json = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c");
  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>JobStrike</title></head>
<body>
<script>
  (function () {
    var payload = ${json(payload)};
    if (window.opener) {
      window.opener.postMessage(payload, ${json(origin)});
      window.close();
      return;
    }
    var params = new URLSearchParams({ mail: payload.ok ? "connected" : "error" });
    if (payload.message) params.set("reason", payload.message);
    window.location.replace("/settings?" + params.toString());
  })();
</script>
<p>You can close this window.</p>
</body>
</html>`;
  const response = new NextResponse(html, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
  clearMailOAuthCookie(response);
  return response;
}
