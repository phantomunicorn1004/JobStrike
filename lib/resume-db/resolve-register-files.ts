import "server-only";

import { getUserGoogleDriveSettings } from "@/lib/auth/google-drive-repository";
import { isGoogleDriveConfigured } from "@/lib/google-drive/config";
import { uploadBufferToGoogleDrive } from "@/lib/google-drive/upload";
import {
  isUserGoogleDriveConnected,
  uploadBufferToUserGoogleDrive,
} from "@/lib/google-drive/user-drive";
import {
  buildStoragePath,
  guessContentType,
  uploadApplicationFile,
} from "@/lib/resume-db/storage";

export type ResolvedRegisterFiles = {
  resumeUrl: string;
  coverLetterUrl: string;
  resumeStoragePath?: string;
  coverStoragePath?: string;
  resumeDriveFileId?: string;
  coverDriveFileId?: string;
  storage: "google_drive_user" | "google_drive_service" | "supabase" | "url_only";
};

async function uploadResumeOrCover(input: {
  userId: string;
  origin: string;
  entryId: string;
  kind: "resume" | "cover";
  urlProvided: string;
  file: File | null;
  useDefault: boolean;
  defaultUrl: string;
}): Promise<{
  url: string;
  storagePath?: string;
  driveFileId?: string;
  storage: ResolvedRegisterFiles["storage"];
}> {
  const { userId, origin, entryId, kind, urlProvided, file, useDefault, defaultUrl } =
    input;

  if (urlProvided) {
    return { url: urlProvided, storage: "url_only" };
  }

  if (useDefault && defaultUrl) {
    return { url: defaultUrl, storage: "url_only" };
  }

  if (!file || file.size === 0) {
    return { url: "", storage: "url_only" };
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const fileName =
    file.name || (kind === "resume" ? "resume.pdf" : "cover_letter.pdf");
  const mimeType = file.type || guessContentType(fileName);

  if (await isUserGoogleDriveConnected(userId)) {
    const upload = await uploadBufferToUserGoogleDrive(
      userId,
      origin,
      buffer,
      fileName,
      mimeType,
    );
    return {
      url: upload.webViewLink,
      driveFileId: upload.fileId,
      storage: "google_drive_user",
    };
  }

  if (isGoogleDriveConfigured()) {
    const upload = await uploadBufferToGoogleDrive(buffer, fileName, mimeType);
    return {
      url: upload.webViewLink,
      driveFileId: upload.fileId,
      storage: "google_drive_service",
    };
  }

  const path = buildStoragePath(entryId, kind, fileName);
  const upload = await uploadApplicationFile(buffer, path, mimeType);
  return {
    url: upload.publicUrl,
    storagePath: upload.storagePath,
    storage: "supabase",
  };
}

export async function resolveRegisterFiles(input: {
  userId: string;
  origin: string;
  entryId: string;
  resumeUrlProvided: string;
  coverUrlProvided: string;
  resumeFile: File | null;
  coverFile: File | null;
  resumeIsDefault: boolean;
  coverIsDefault: boolean;
}): Promise<ResolvedRegisterFiles> {
  const driveSettings = await getUserGoogleDriveSettings(input.userId);

  const resume = await uploadResumeOrCover({
    userId: input.userId,
    origin: input.origin,
    entryId: input.entryId,
    kind: "resume",
    urlProvided: input.resumeUrlProvided,
    file: input.resumeFile,
    useDefault: input.resumeIsDefault,
    defaultUrl: driveSettings?.defaultResumeUrl ?? "",
  });

  const cover = await uploadResumeOrCover({
    userId: input.userId,
    origin: input.origin,
    entryId: input.entryId,
    kind: "cover",
    urlProvided: input.coverUrlProvided,
    file: input.coverFile,
    useDefault: input.coverIsDefault,
    defaultUrl: driveSettings?.defaultCoverUrl ?? "",
  });

  const storage =
    resume.storage === "google_drive_user" ||
    cover.storage === "google_drive_user"
      ? "google_drive_user"
      : resume.storage === "google_drive_service" ||
          cover.storage === "google_drive_service"
        ? "google_drive_service"
        : resume.storage === "supabase" || cover.storage === "supabase"
          ? "supabase"
          : "url_only";

  if (
    (input.resumeFile?.size || input.resumeIsDefault) &&
    !resume.url &&
    !input.resumeUrlProvided
  ) {
    if (input.resumeIsDefault) {
      throw new Error(
        "Default resume link is not set. Add it under Settings → Google Drive on the website.",
      );
    }
    throw new Error(
      "Google Drive is not connected. Connect Google Drive on the website Settings page before uploading files.",
    );
  }

  return {
    resumeUrl: resume.url,
    coverLetterUrl: cover.url,
    resumeStoragePath: resume.storagePath,
    coverStoragePath: cover.storagePath,
    resumeDriveFileId: resume.driveFileId,
    coverDriveFileId: cover.driveFileId,
    storage,
  };
}
