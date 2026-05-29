import { randomUUID } from "crypto";
import { Readable } from "stream";
import { google } from "googleapis";
import { getGoogleAuth } from "@/lib/google-sheets/client";

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";

export type DriveUploadResult = {
  fileId: string;
  fileName: string;
  webViewLink: string;
  webContentLink: string;
};

export function getDriveFolderId(): string {
  const id = process.env.GOOGLE_DRIVE_FOLDER_ID?.trim();
  if (!id) {
    throw new Error(
      "GOOGLE_DRIVE_FOLDER_ID is not set. Create a Drive folder and share it with the service account.",
    );
  }
  return id;
}

function sanitizeBaseName(name: string): string {
  return name.replace(/[^\w.\-()+\s]/g, "_").replace(/\s+/g, "_").slice(0, 80);
}

export function buildUniqueFileName(
  entryId: string,
  kind: "resume" | "cover",
  originalName: string,
): string {
  const ext = originalName.includes(".")
    ? originalName.slice(originalName.lastIndexOf("."))
    : "";
  const base = sanitizeBaseName(
    originalName.replace(/\.[^/.]+$/, "") || kind,
  );
  return `${entryId}_${kind}_${base}${ext || ".pdf"}`;
}

export async function uploadFileToGoogleDrive(
  buffer: Buffer,
  fileName: string,
  mimeType: string,
): Promise<DriveUploadResult> {
  const auth = getGoogleAuth([DRIVE_SCOPE]);
  const drive = google.drive({ version: "v3", auth });
  const folderId = getDriveFolderId();

  const created = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [folderId],
    },
    media: {
      mimeType,
      body: Readable.from(buffer),
    },
    fields: "id, name, webViewLink, webContentLink",
    supportsAllDrives: true,
  });

  const fileId = created.data.id;
  if (!fileId) {
    throw new Error("Drive upload failed: no file id returned.");
  }

  await drive.permissions.create({
    fileId,
    requestBody: { role: "reader", type: "anyone" },
    supportsAllDrives: true,
  });

  const meta = await drive.files.get({
    fileId,
    fields: "id, name, webViewLink, webContentLink",
    supportsAllDrives: true,
  });

  return {
    fileId,
    fileName: meta.data.name ?? fileName,
    webViewLink:
      meta.data.webViewLink ??
      `https://drive.google.com/file/d/${fileId}/view`,
    webContentLink:
      meta.data.webContentLink ??
      `https://drive.google.com/uc?id=${fileId}&export=download`,
  };
}

export function newEntryId(): string {
  return randomUUID().replace(/-/g, "").slice(0, 12);
}

export function guessMimeType(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".docx")) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (lower.endsWith(".doc")) return "application/msword";
  if (lower.endsWith(".txt")) return "text/plain";
  return "application/octet-stream";
}
