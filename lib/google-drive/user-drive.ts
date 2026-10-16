import "server-only";

import { Readable } from "node:stream";
import { google } from "googleapis";
import {
  getUserGoogleDriveSettings,
  type UserGoogleDriveSettings,
} from "@/lib/auth/google-drive-repository";
import {
  oauth2ClientWithRefreshToken,
  resolveGoogleOAuthCredentials,
} from "@/lib/google-drive/oauth-web";
import { googleDriveViewUrl, normalizeGoogleDriveFolderId } from "@/lib/google-drive/urls";
import type { DriveUploadResult } from "@/lib/google-drive/upload";

export type { DriveUploadResult };

export async function isUserGoogleDriveConnected(
  userId: string,
): Promise<boolean> {
  const settings = await getUserGoogleDriveSettings(userId);
  return Boolean(settings?.refreshToken);
}

export async function getConnectedUserDriveSettings(
  userId: string,
): Promise<UserGoogleDriveSettings | null> {
  const settings = await getUserGoogleDriveSettings(userId);
  if (!settings?.refreshToken) return null;
  return settings;
}

async function driveFromRefreshToken(
  userId: string,
  origin: string,
  refreshToken: string,
) {
  const credentials = await resolveGoogleOAuthCredentials(userId, origin);
  if (!credentials) {
    throw new Error(
      "Google OAuth is not configured. Add OAuth Client ID and Secret in Settings.",
    );
  }
  const auth = oauth2ClientWithRefreshToken(credentials, refreshToken);
  return google.drive({ version: "v3", auth });
}

/** Google refused the saved sign-in: revoked, or expired (weekly while the OAuth app is in Testing). */
export const DRIVE_RECONNECT_MESSAGE =
  "Google Drive sign-in has expired. Reconnect Google Drive on the website (Settings → Google Drive), then register again.";

function isExpiredGrant(error: unknown): boolean {
  const e = error as { message?: string; response?: { data?: { error?: string } } } | null;
  return (
    e?.response?.data?.error === "invalid_grant" ||
    /invalid_grant|token has been expired or revoked/i.test(String(e?.message || ""))
  );
}

export async function uploadBufferToUserGoogleDrive(
  userId: string,
  origin: string,
  buffer: Buffer,
  fileName: string,
  mimeType: string,
): Promise<DriveUploadResult> {
  try {
    const settings = await getConnectedUserDriveSettings(userId);
    if (!settings) {
      throw new Error(
        "Google Drive is not connected. Open Settings on the website and connect your Google account.",
      );
    }

    const drive = await driveFromRefreshToken(
      userId,
      origin,
      settings.refreshToken,
    );
    const folderId = normalizeGoogleDriveFolderId(settings.folderId || "");
    const parents = folderId ? [folderId] : undefined;

    const created = await drive.files.create({
      requestBody: {
        name: fileName,
        parents,
      },
      media: {
        mimeType,
        body: Readable.from(buffer),
      },
      fields: "id, name, webViewLink",
    });

    const fileId = created.data.id;
    if (!fileId) {
      throw new Error("Google Drive upload did not return a file id.");
    }

    await drive.permissions.create({
      fileId,
      requestBody: {
        role: "reader",
        type: "anyone",
      },
    });

    const webViewLink =
      created.data.webViewLink || googleDriveViewUrl(fileId);

    return {
      fileId,
      webViewLink,
      name: created.data.name || fileName,
    };
  } catch (error) {
    if (isExpiredGrant(error)) throw new Error(DRIVE_RECONNECT_MESSAGE);
    throw error;
  }
}

export async function deleteUserGoogleDriveFile(
  userId: string,
  origin: string,
  fileId: string,
): Promise<void> {
  const settings = await getConnectedUserDriveSettings(userId);
  if (!settings) return;

  const drive = await driveFromRefreshToken(
    userId,
    origin,
    settings.refreshToken,
  );
  try {
    await drive.files.delete({ fileId });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/not found|404/i.test(message)) return;
    throw error;
  }
}

export async function downloadUserDriveFile(
  userId: string,
  origin: string,
  fileId: string,
): Promise<{ buffer: Buffer; mimeType: string; name: string }> {
  const settings = await getConnectedUserDriveSettings(userId);
  if (!settings) {
    throw new Error(
      "Google Drive is not connected. Open Settings on the website and connect your Google account.",
    );
  }

  const drive = await driveFromRefreshToken(
    userId,
    origin,
    settings.refreshToken,
  );

  const meta = await drive.files.get({
    fileId,
    fields: "name, mimeType",
  });

  const media = await drive.files.get(
    { fileId, alt: "media" },
    { responseType: "arraybuffer" },
  );

  return {
    buffer: Buffer.from(media.data as ArrayBuffer),
    mimeType: meta.data.mimeType || "application/octet-stream",
    name: meta.data.name || "file",
  };
}
