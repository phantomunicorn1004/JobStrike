import { NextRequest, NextResponse } from "next/server";
import { requireRequestUser, unauthorizedJson } from "@/lib/auth/resolve-request-user";
import { isSecretEncryptionConfigured } from "@/lib/crypto/secret-box";
import { listMailAccounts, MailSetupRequiredError } from "@/lib/integrations/accounts-repository";
import { getMailOAuthProvider } from "@/lib/integrations/providers";
import { MAIL_PROVIDERS, type MailAccountsResponse, type MailProvider } from "@/lib/integrations/types";
import { listProfiles } from "@/lib/resume-db/repository";

/** The Email & Calendar card: connected mailboxes, candidate profiles, and what can be connected. */
export async function GET(request: NextRequest) {
  try {
    const user = await requireRequestUser(request);
    const origin = new URL(request.url).origin;

    const providers = Object.fromEntries(
      await Promise.all(
        MAIL_PROVIDERS.map(async (p) => [p, await (await getMailOAuthProvider(p)).isConfigured(user.id, origin)]),
      ),
    ) as Record<MailProvider, boolean>;

    const [profiles, accounts] = await Promise.all([
      listProfiles(user.id),
      listMailAccounts(user.id).catch((error: unknown) => {
        if (error instanceof MailSetupRequiredError) return null;
        throw error;
      }),
    ]);

    const body: MailAccountsResponse = {
      accounts: accounts ?? [],
      profiles: profiles.map((p) => ({ id: p.id, fullName: p.full_name })),
      providers,
      encryptionReady: isSecretEncryptionConfigured(),
      setupRequired: accounts === null,
    };
    return NextResponse.json(body);
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json(unauthorizedJson(), { status: 401 });
    }
    console.error("Mail accounts error:", error);
    return NextResponse.json({ error: "Could not load connected mailboxes." }, { status: 500 });
  }
}
