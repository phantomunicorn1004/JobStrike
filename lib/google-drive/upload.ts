import { Readable } from "node:stream";
import { getDriveClient } from "@/lib/google-drive/client";
import { getGoogleDriveFolderId } from "@/lib/google-drive/config";
import { googleDriveViewUrl } from "@/lib/google-drive/urls";

export type DriveUploadResult = {
  fileId: string;
  webViewLink: string;
  name: string;
};

export async function uploadBufferToGoogleDrive(
  buffer: Buffer,
  fileName: string,
  mimeType: string,
): Promise<DriveUploadResult> {
  const drive = getDriveClient();
  const folderId = getGoogleDriveFolderId();

  const created = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: folderId ? [folderId] : undefined,
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

export async function downloadDriveFile(fileId: string): Promise<{
  buffer: Buffer;
  mimeType: string;
  name: string;
}> {
  const drive = getDriveClient();
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
    name: meta.data.name || "resume.pdf",
  };
}
