import "server-only";

import { Readable } from "node:stream";
import { google } from "googleapis";
import {
  getUserGoogleDriveSettings,
  type UserGoogleDriveSettings,
} from "@/lib/auth/google-drive-repository";
import { oauth2ClientWithRefreshToken } from "@/lib/google-drive/oauth-web";
import { googleDriveViewUrl } from "@/lib/google-drive/urls";
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

function driveFromRefreshToken(refreshToken: string, origin: string) {
  const auth = oauth2ClientWithRefreshToken(origin, refreshToken);
  return google.drive({ version: "v3", auth });
}

export async function uploadBufferToUserGoogleDrive(
  userId: string,
  origin: string,
  buffer: Buffer,
  fileName: string,
  mimeType: string,
): Promise<DriveUploadResult> {
  const settings = await getConnectedUserDriveSettings(userId);
  if (!settings) {
    throw new Error(
      "Google Drive is not connected. Open Settings on the website and connect your Google account.",
    );
  }

  const drive = driveFromRefreshToken(settings.refreshToken, origin);
  const parents = settings.folderId ? [settings.folderId] : undefined;

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
}

export async function deleteUserGoogleDriveFile(
  userId: string,
  origin: string,
  fileId: string,
): Promise<void> {
  const settings = await getConnectedUserDriveSettings(userId);
  if (!settings) return;

  const drive = driveFromRefreshToken(settings.refreshToken, origin);
  try {
    await drive.files.delete({ fileId });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/not found|404/i.test(message)) return;
    throw error;
  }
}
