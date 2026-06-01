import { NextRequest } from "next/server";
import { corsJson, corsOptions } from "@/lib/api/extensionCors";
import {
  requireRequestUser,
  resolveRequestUser,
  unauthorizedJson,
} from "@/lib/auth/resolve-request-user";
import { getUserGoogleDriveSettings } from "@/lib/auth/google-drive-repository";
import { isGoogleDriveConfigured } from "@/lib/google-drive/config";
import { isGoogleOAuthWebConfigured } from "@/lib/google-drive/oauth-web";

export function OPTIONS() {
  return corsOptions();
}

export async function GET(request: NextRequest) {
  try {
    const user = await resolveRequestUser(request);
    if (!user) {
      return corsJson(unauthorizedJson(), { status: 401 });
    }

    const settings = await getUserGoogleDriveSettings(user.id);

    return corsJson({
      connected: Boolean(settings?.refreshToken),
      googleEmail: settings?.googleEmail ?? null,
      folderId: settings?.folderId ?? "",
      defaultResumeUrl: settings?.defaultResumeUrl ?? "",
      defaultCoverUrl: settings?.defaultCoverUrl ?? "",
      oauthWebConfigured: isGoogleOAuthWebConfigured(),
      serviceAccountConfigured: isGoogleDriveConfigured(),
    });
  } catch (error) {
    console.error("Google Drive status error:", error);
    const message = error instanceof Error ? error.message : "Status failed.";
    return corsJson({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const user = await requireRequestUser(request);
    const body = (await request.json()) as Record<string, unknown>;

    const { updateUserGoogleDrivePreferences } = await import(
      "@/lib/auth/google-drive-repository"
    );

    await updateUserGoogleDrivePreferences(user.id, {
      folderId:
        body.folderId !== undefined ? String(body.folderId) : undefined,
      defaultResumeUrl:
        body.defaultResumeUrl !== undefined
          ? String(body.defaultResumeUrl)
          : undefined,
      defaultCoverUrl:
        body.defaultCoverUrl !== undefined
          ? String(body.defaultCoverUrl)
          : undefined,
    });

    const settings = await getUserGoogleDriveSettings(user.id);
    return corsJson({
      ok: true,
      folderId: settings?.folderId ?? "",
      defaultResumeUrl: settings?.defaultResumeUrl ?? "",
      defaultCoverUrl: settings?.defaultCoverUrl ?? "",
    });
  } catch (error) {
    console.error("Google Drive preferences error:", error);
    const message = error instanceof Error ? error.message : "Update failed.";
    return corsJson({ error: message }, { status: 500 });
  }
}
