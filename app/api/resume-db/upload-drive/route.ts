import { NextRequest } from "next/server";
import { corsJson, corsOptions, verifyExtensionKey } from "@/lib/api/extensionCors";
import { isGoogleDriveConfigured } from "@/lib/google-drive/config";
import { uploadBufferToGoogleDrive } from "@/lib/google-drive/upload";
import { guessContentType } from "@/lib/resume-db/storage";

export function OPTIONS() {
  return corsOptions();
}

function errorStatus(message: string): number {
  const lower = message.toLowerCase();
  if (lower.includes("unauthorized")) return 401;
  if (lower.includes("not configured")) return 503;
  if (lower.includes("required") || lower.includes("invalid")) return 400;
  return 500;
}

export async function POST(request: NextRequest) {
  const authError = verifyExtensionKey(request);
  if (authError) {
    return corsJson({ error: authError }, { status: 401 });
  }

  if (!isGoogleDriveConfigured()) {
    return corsJson(
      {
        error:
          "Google Drive is not configured on the server. Set GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY.",
        configured: false,
      },
      { status: 503 },
    );
  }

  try {
    const formData = await request.formData();
    const resumeFile = formData.get("resume") as File | null;
    const coverFile = formData.get("coverLetter") as File | null;

    if (!resumeFile || resumeFile.size === 0) {
      return corsJson({ error: "resume file is required." }, { status: 400 });
    }

    const resumeBuffer = Buffer.from(await resumeFile.arrayBuffer());
    const resumeName = resumeFile.name || "resume.pdf";
    const resumeMime =
      resumeFile.type || guessContentType(resumeName);

    const resumeUpload = await uploadBufferToGoogleDrive(
      resumeBuffer,
      resumeName,
      resumeMime,
    );

    let coverLetterUrl = "";
    let coverLetterFileId = "";
    if (coverFile && coverFile.size > 0) {
      const coverBuffer = Buffer.from(await coverFile.arrayBuffer());
      const coverName = coverFile.name || "cover_letter.pdf";
      const coverMime = coverFile.type || guessContentType(coverName);
      const coverUpload = await uploadBufferToGoogleDrive(
        coverBuffer,
        coverName,
        coverMime,
      );
      coverLetterUrl = coverUpload.webViewLink;
      coverLetterFileId = coverUpload.fileId;
    }

    return corsJson({
      ok: true,
      resumeUrl: resumeUpload.webViewLink,
      resumeFileId: resumeUpload.fileId,
      coverLetterUrl,
      coverLetterFileId,
    });
  } catch (error) {
    console.error("Resume DB upload-drive error:", error);
    const message =
      error instanceof Error ? error.message : "Google Drive upload failed.";
    return corsJson({ error: message }, { status: errorStatus(message) });
  }
}
