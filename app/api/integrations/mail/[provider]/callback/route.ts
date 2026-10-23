import { after, NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { MailSetupRequiredError, saveConnectedMailAccount } from "@/lib/integrations/accounts-repository";
import { mailOAuthResultResponse, readMailOAuthFlow } from "@/lib/integrations/oauth-state";
import { getMailOAuthProvider, MailConnectError } from "@/lib/integrations/providers";
import { MAIL_PROVIDER_LABELS, parseMailProvider } from "@/lib/integrations/types";
import { getSyncAccount } from "@/lib/mail/sync-repository";
import { processPendingMessages } from "@/lib/mail/process";
import { ensureLiveUpdates, syncAccount } from "@/lib/mail/sync";

export const maxDuration = 60;

type RouteContext = { params: Promise<{ provider: string }> };

/** Where Google / Microsoft send the browser back after the consent screen. */
export async function GET(request: NextRequest, context: RouteContext) {
  const provider = parseMailProvider((await context.params).provider);
  if (!provider) return NextResponse.json({ error: "Unknown provider." }, { status: 404 });

  const label = MAIL_PROVIDER_LABELS[provider];
  const params = request.nextUrl.searchParams;
  const fail = (message: string) => mailOAuthResultResponse(request, { ok: false, message });

  let flow;
  try {
    flow = readMailOAuthFlow(request, provider, params.get("state"));
    // The mailbox is linked to whoever is signed in here, and only if that is who started it.
    const session = await getSessionUser();
    if (!session || session.id !== flow.userId) {
      throw new Error("Signed-in user does not match the connect request.");
    }
  } catch (error) {
    console.warn(`Mail connect (${provider}) rejected:`, error instanceof Error ? error.message : error);
    return fail("This sign-in did not come from your Settings page, or took too long. Please connect again.");
  }

  const providerError = params.get("error");
  if (providerError) {
    if (providerError === "access_denied") return fail(`${label} access was not allowed.`);
    const detail = params.get("error_description")?.split(/\r?\n/)[0] || providerError;
    return fail(`${label} sign-in failed: ${detail}`);
  }
  const code = params.get("code");
  if (!code) return fail(`${label} did not complete the sign-in. Please connect again.`);

  try {
    const origin = new URL(request.url).origin;
    const impl = await getMailOAuthProvider(provider);
    const mailbox = await impl.exchangeCode({ userId: flow.userId, origin, code, codeVerifier: flow.codeVerifier });
    const account = await saveConnectedMailAccount(flow.userId, provider, flow.profileId, mailbox);
    // First scan and live updates start right away, after the popup has its answer.
    after(async () => {
      const deadline = Date.now() + 50_000;
      try {
        const stored = await getSyncAccount(account.id);
        if (stored) await ensureLiveUpdates(stored);
      } catch (error) {
        console.warn(`Live updates for account ${account.id} failed:`, error instanceof Error ? error.message : error);
      }
      await syncAccount(account.id, deadline);
      await processPendingMessages(flow.userId, deadline);
    });
    return mailOAuthResultResponse(request, { ok: true, email: account.email });
  } catch (error) {
    if (error instanceof MailConnectError || error instanceof MailSetupRequiredError) {
      return fail(error.message);
    }
    // Messages from the libraries can be long; tokens never appear in them.
    console.error(`Mail connect (${provider}) failed:`, error instanceof Error ? error.message : error);
    return fail(`Could not finish connecting ${label}. Please try again.`);
  }
}
