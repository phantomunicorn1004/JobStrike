import { isGoogleDriveConfigured } from "@/lib/google-drive/config";
import { downloadGoogleDrivePublicFile } from "@/lib/google-drive/downloadPublicFile";
import { downloadDriveFile } from "@/lib/google-drive/upload";
import {
  downloadUserDriveFile,
  isUserGoogleDriveConnected,
} from "@/lib/google-drive/user-drive";
import {
  extractGoogleDriveFileId,
  isGoogleDriveUrl,
} from "@/lib/google-drive/urls";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

const BUCKET = "resume-db";

export type DownloadFileOptions = {
  fileUrl: string;
  fallbackName: string;
  storagePath?: string | null;
  driveFileId?: string | null;
  userId?: string;
  origin?: string;
};

function guessNameFromUrl(url: string, fallback: string): string {
  try {
    const pathname = new URL(url).pathname;
    const segment = pathname.split("/").pop();
    if (segment && segment.length < 120 && segment.includes(".")) {
      return decodeURIComponent(segment);
    }
  } catch {
    /* ignore */
  }
  return fallback;
}

function resolveDriveFileId(
  driveFileId: string | null | undefined,
  fileUrl: string,
): string | null {
  const stored = driveFileId?.trim();
  if (stored) return stored;
  return extractGoogleDriveFileId(fileUrl);
}

export async function downloadFileFromUrl(
  fileUrl: string,
  fallbackName: string,
  storagePath?: string | null,
  options?: Pick<DownloadFileOptions, "driveFileId" | "userId" | "origin">,
): Promise<{ buffer: Buffer; fileName: string; contentType: string }> {
  return downloadApplicationDocument({
    fileUrl,
    fallbackName,
    storagePath,
    driveFileId: options?.driveFileId,
    userId: options?.userId,
    origin: options?.origin,
  });
}

export async function downloadApplicationDocument(
  options: DownloadFileOptions,
): Promise<{ buffer: Buffer; fileName: string; contentType: string }> {
  const { fileUrl, fallbackName, storagePath, driveFileId, userId, origin } =
    options;

  if (storagePath?.trim()) {
    const supabase = getSupabaseAdminClient();
    const { data, error } = await supabase.storage.from(BUCKET).download(storagePath);
    if (error) throw new Error(error.message);
    const buffer = Buffer.from(await data.arrayBuffer());
    const fileName = storagePath.split("/").pop() || fallbackName;
    return {
      buffer,
      fileName,
      contentType: data.type || "application/octet-stream",
    };
  }

  const resolvedDriveId = resolveDriveFileId(driveFileId, fileUrl);

  if (resolvedDriveId && userId && origin) {
    try {
      if (await isUserGoogleDriveConnected(userId)) {
        const fromDrive = await downloadUserDriveFile(
          userId,
          origin,
          resolvedDriveId,
        );
        return {
          buffer: fromDrive.buffer,
          fileName: fromDrive.name,
          contentType: fromDrive.mimeType,
        };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/not connected|oauth is not configured/i.test(message)) {
        throw error;
      }
      /* Fall through to service account / public download */
    }
  }

  if (resolvedDriveId && isGoogleDriveConfigured()) {
    try {
      const fromDrive = await downloadDriveFile(resolvedDriveId);
      return {
        buffer: fromDrive.buffer,
        fileName: fromDrive.name,
        contentType: fromDrive.mimeType,
      };
    } catch {
      /* User-owned Drive file — try public link download below */
    }
  }

  if (resolvedDriveId) {
    return downloadGoogleDrivePublicFile(
      resolvedDriveId,
      guessNameFromUrl(fileUrl, fallbackName),
    );
  }

  if (!fileUrl?.trim()) {
    throw new Error("No file available to download.");
  }

  const res = await fetch(fileUrl, { redirect: "follow" });
  if (!res.ok) {
    throw new Error(`Failed to download file (${res.status}).`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  const fileName = guessNameFromUrl(fileUrl, fallbackName);
  const contentType =
    res.headers.get("content-type")?.split(";")[0]?.trim() ||
    "application/octet-stream";

  if (isGoogleDriveUrl(fileUrl) && buffer.subarray(0, 20).toString("utf8").includes("<")) {
    throw new Error("Google Drive link did not return a downloadable file.");
  }

  return { buffer, fileName, contentType };
}
