import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { isSecretEncryptionConfigured } from "@/lib/crypto/secret-box";
import {
  createMailOAuthFlow,
  mailOAuthResultResponse,
  setMailOAuthCookie,
} from "@/lib/integrations/oauth-state";
import { getMailOAuthProvider } from "@/lib/integrations/providers";
import { MAIL_PROVIDER_LABELS, parseMailProvider } from "@/lib/integrations/types";
import { getProfileById } from "@/lib/resume-db/repository";

type RouteContext = { params: Promise<{ provider: string }> };

/** Starts connecting a mailbox: GET ?profileId=&popup=1, opened by the Settings card. */
export async function GET(request: NextRequest, context: RouteContext) {
  const provider = parseMailProvider((await context.params).provider);
  if (!provider) return NextResponse.json({ error: "Unknown provider." }, { status: 404 });

  const session = await getSessionUser();
  if (!session || session.role !== "member") {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", "/settings");
    return NextResponse.redirect(loginUrl);
  }

  const fail = (message: string) => mailOAuthResultResponse(request, { ok: false, message });
  const label = MAIL_PROVIDER_LABELS[provider];

  try {
    if (!isSecretEncryptionConfigured()) {
      return fail("The server has no TOKEN_ENCRYPTION_KEY, so it cannot store mailbox sign-ins.");
    }
    const origin = new URL(request.url).origin;
    const impl = await getMailOAuthProvider(provider);
    if (!(await impl.isConfigured(session.id, origin))) {
      return fail(`${label} sign-in is not set up on this server yet.`);
    }

    // The mailbox belongs to a candidate profile; its address pre-selects the right account.
    const rawProfileId = request.nextUrl.searchParams.get("profileId");
    let profileId: number | null = null;
    let loginHint: string | null = null;
    if (rawProfileId) {
      const id = Number(rawProfileId);
      const profile = Number.isInteger(id) ? await getProfileById(session.id, id) : null;
      if (!profile) return fail("That candidate profile was not found.");
      profileId = profile.id;
      loginHint = profile.autofill?.applicationEmail?.trim() || profile.work_emails?.[0]?.trim() || null;
    }

    const flow = createMailOAuthFlow({ provider, userId: session.id, profileId });
    const url = await impl.authorizationUrl({
      userId: session.id,
      origin,
      state: flow.state,
      codeChallenge: flow.codeChallenge,
      loginHint,
    });
    const response = NextResponse.redirect(url);
    setMailOAuthCookie(response, flow.cookieValue);
    return response;
  } catch (error) {
    console.error(`Mail connect (${provider}) failed to start:`, error instanceof Error ? error.message : error);
    return fail(`Could not start ${label} sign-in. Please try again.`);
  }
}
