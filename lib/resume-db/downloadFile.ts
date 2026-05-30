import { isGoogleDriveConfigured } from "@/lib/google-drive/config";
import { downloadGoogleDrivePublicFile } from "@/lib/google-drive/downloadPublicFile";
import { downloadDriveFile } from "@/lib/google-drive/upload";
import {
  extractGoogleDriveFileId,
  isGoogleDriveUrl,
} from "@/lib/google-drive/urls";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

const BUCKET = "resume-db";

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

export async function downloadFileFromUrl(
  fileUrl: string,
  fallbackName: string,
  storagePath?: string | null,
): Promise<{ buffer: Buffer; fileName: string; contentType: string }> {
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

  const driveId = extractGoogleDriveFileId(fileUrl);

  if (driveId && isGoogleDriveConfigured()) {
    try {
      const fromDrive = await downloadDriveFile(driveId);
      return {
        buffer: fromDrive.buffer,
        fileName: fromDrive.name,
        contentType: fromDrive.mimeType,
      };
    } catch {
      /* User-owned Drive file — try public link download below */
    }
  }

  if (driveId) {
    return downloadGoogleDrivePublicFile(
      driveId,
      guessNameFromUrl(fileUrl, fallbackName),
    );
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
