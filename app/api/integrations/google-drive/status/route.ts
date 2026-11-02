import { NextRequest } from "next/server";
import { corsJson, corsOptions } from "@/lib/api/extensionCors";
import {
  requireRequestUser,
  resolveRequestUser,
  unauthorizedJson,
} from "@/lib/auth/resolve-request-user";
import {
  getUserGoogleDriveConnection,
  getUserGoogleOAuthCredentials,
  updateUserGoogleOAuthCredentials,
} from "@/lib/auth/google-drive-repository";
import { isGoogleDriveConfigured } from "@/lib/google-drive/config";
import {
  getGoogleOAuthRedirectUri,
  isGoogleOAuthWebConfigured,
} from "@/lib/google-drive/oauth-web";

export function OPTIONS() {
  return corsOptions();
}

/**
 * The Drive connection and the user's OAuth client, read once each. OAuth is ready when the
 * server's client is set or the user's own client is complete.
 */
async function readDriveStatus(userId: string, origin: string) {
  const [connection, oauthCreds] = await Promise.all([
    getUserGoogleDriveConnection(userId),
    getUserGoogleOAuthCredentials(userId),
  ]);
  return {
    connected: Boolean(connection?.refreshToken),
    googleEmail: connection?.googleEmail ?? null,
    folderId: connection?.folderId ?? "",
    defaultResumeUrl: connection?.defaultResumeUrl ?? "",
    defaultCoverUrl: connection?.defaultCoverUrl ?? "",
    oauthReady:
      isGoogleOAuthWebConfigured() || Boolean(oauthCreds.clientId && oauthCreds.clientSecret),
    hasOAuthClientId: Boolean(oauthCreds.clientId),
    oauthClientId: oauthCreds.clientId,
    redirectUri: getGoogleOAuthRedirectUri(origin),
  };
}

export async function GET(request: NextRequest) {
  try {
    const user = await resolveRequestUser(request);
    if (!user) {
      return corsJson(unauthorizedJson(), { status: 401 });
    }

    const origin = new URL(request.url).origin;
    return corsJson({
      ...(await readDriveStatus(user.id, origin)),
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
    const origin = new URL(request.url).origin;

    if (
      body.oauthClientId !== undefined ||
      body.oauthClientSecret !== undefined
    ) {
      await updateUserGoogleOAuthCredentials(user.id, {
        clientId:
          body.oauthClientId !== undefined
            ? String(body.oauthClientId)
            : undefined,
        clientSecret:
          body.oauthClientSecret !== undefined
            ? String(body.oauthClientSecret)
            : undefined,
      });
    }

    if (
      body.folderId !== undefined ||
      body.defaultResumeUrl !== undefined ||
      body.defaultCoverUrl !== undefined
    ) {
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
    }

    return corsJson({ ok: true, ...(await readDriveStatus(user.id, origin)) });
  } catch (error) {
    console.error("Google Drive preferences error:", error);
    const message = error instanceof Error ? error.message : "Update failed.";
    return corsJson({ error: message }, { status: 500 });
  }
}
