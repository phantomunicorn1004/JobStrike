import { NextRequest, NextResponse } from "next/server";
import { getUserGoogleDriveConnection } from "@/lib/auth/google-drive-repository";
import { requireRequestUser, unauthorizedJson } from "@/lib/auth/resolve-request-user";
import {
  deleteMailAccount,
  isMailAccountId,
  MailSetupRequiredError,
  updateMailAccountSettings,
} from "@/lib/integrations/accounts-repository";
import { getMailOAuthProvider } from "@/lib/integrations/providers";
import { parseMailAutomation, type MailAutomation } from "@/lib/integrations/types";
import { getSyncAccount } from "@/lib/mail/sync-repository";
import { stopLiveUpdates } from "@/lib/mail/sync";
import { getProfileById } from "@/lib/resume-db/repository";

type RouteContext = { params: Promise<{ id: string }> };

function errorResponse(error: unknown, fallback: string) {
  if (error instanceof Error && error.message === "Unauthorized") {
    return NextResponse.json(unauthorizedJson(), { status: 401 });
  }
  if (error instanceof MailSetupRequiredError) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }
  console.error("Mail account error:", error);
  return NextResponse.json({ error: fallback }, { status: 500 });
}

const notFound = () => NextResponse.json({ error: "Mailbox not found." }, { status: 404 });

/** Body: { profileId?: number | null, automation?: "auto" | "suggest" | "off" } */
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const user = await requireRequestUser(request);
    const { id } = await context.params;
    if (!isMailAccountId(id)) return notFound();

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const changes: { profileId?: number | null; automation?: MailAutomation } = {};

    if (body.automation !== undefined) {
      const automation = parseMailAutomation(body.automation);
      if (!automation) return NextResponse.json({ error: "Unknown automation mode." }, { status: 400 });
      changes.automation = automation;
    }
    if (body.profileId !== undefined) {
      if (body.profileId === null) {
        changes.profileId = null;
      } else {
        const profileId = Number(body.profileId);
        const profile = Number.isInteger(profileId) ? await getProfileById(user.id, profileId) : null;
        if (!profile) return NextResponse.json({ error: "That candidate profile was not found." }, { status: 400 });
        changes.profileId = profile.id;
      }
    }

    const account = await updateMailAccountSettings(user.id, id, changes);
    return account ? NextResponse.json({ account }) : notFound();
  } catch (error) {
    return errorResponse(error, "Could not save the mailbox settings.");
  }
}

/** Disconnect: withdraws access where the provider allows it, then deletes the mailbox and its data. */
export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const user = await requireRequestUser(request);
    const { id } = await context.params;
    if (!isMailAccountId(id)) return notFound();

    // Stop Microsoft's change notifications while the sign-in is still stored.
    const stored = await getSyncAccount(id);
    if (stored?.user_id === user.id) await stopLiveUpdates(stored);

    const removed = await deleteMailAccount(user.id, id);
    if (!removed) return notFound();

    let revoked = false;
    if (removed.refreshToken) {
      // Google withdraws everything the account granted JobStrike at once, which would also end a
      // Google Drive connection to the same account; leave the grant in place in that case.
      const drive = removed.provider === "google" ? await getUserGoogleDriveConnection(user.id) : null;
      const sharedWithDrive = drive?.googleEmail?.trim().toLowerCase() === removed.email;
      if (!sharedWithDrive) {
        revoked = await (await getMailOAuthProvider(removed.provider))
          .revoke(removed.refreshToken)
          .catch(() => false);
      }
    }
    return NextResponse.json({ ok: true, revoked });
  } catch (error) {
    return errorResponse(error, "Could not disconnect the mailbox.");
  }
}
