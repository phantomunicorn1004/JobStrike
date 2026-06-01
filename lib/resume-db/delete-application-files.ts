import "server-only";

import { extractGoogleDriveFileId } from "@/lib/google-drive/urls";
import {
  deleteUserGoogleDriveFile,
  isUserGoogleDriveConnected,
} from "@/lib/google-drive/user-drive";
import { isGoogleDriveConfigured } from "@/lib/google-drive/config";
import { getDriveClient } from "@/lib/google-drive/client";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import type { ResumeDbApplication } from "@/lib/resume-db/types";

const BUCKET = "resume-db";

async function deleteSupabaseObject(path: string | null | undefined) {
  if (!path?.trim()) return;
  const supabase = getSupabaseAdminClient();
  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  if (error && !/not found/i.test(error.message)) {
    console.warn("Supabase storage delete:", error.message);
  }
}

async function deleteServiceAccountDriveFile(fileId: string) {
  if (!isGoogleDriveConfigured()) return;
  try {
    const drive = getDriveClient();
    await drive.files.delete({ fileId });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/not found|404/i.test(message)) {
      console.warn("Service account Drive delete:", message);
    }
  }
}

/** Best-effort cleanup of resume/cover files when removing a DB row. */
export async function deleteApplicationFiles(
  userId: string,
  origin: string,
  app: ResumeDbApplication,
): Promise<void> {
  await deleteSupabaseObject(app.resumeStoragePath);
  await deleteSupabaseObject(app.coverLetterStoragePath);

  const resumeFileId =
    app.resumeDriveFileId?.trim() ||
    extractGoogleDriveFileId(app.resumeUrl) ||
    null;
  const coverFileId =
    app.coverDriveFileId?.trim() ||
    extractGoogleDriveFileId(app.coverLetterUrl) ||
    null;

  const userConnected = await isUserGoogleDriveConnected(userId);

  if (resumeFileId) {
    if (userConnected) {
      try {
        await deleteUserGoogleDriveFile(userId, origin, resumeFileId);
      } catch (error) {
        console.warn("User Drive resume delete:", error);
      }
    } else {
      await deleteServiceAccountDriveFile(resumeFileId);
    }
  }

  if (coverFileId) {
    if (userConnected) {
      try {
        await deleteUserGoogleDriveFile(userId, origin, coverFileId);
      } catch (error) {
        console.warn("User Drive cover delete:", error);
      }
    } else {
      await deleteServiceAccountDriveFile(coverFileId);
    }
  }
}
