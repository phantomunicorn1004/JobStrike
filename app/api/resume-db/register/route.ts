import { NextRequest } from "next/server";
import { appendResumeDbEntry } from "@/lib/google-sheets/resumeDbSheet";
import {
  buildUniqueFileName,
  guessMimeType,
  newEntryId,
  uploadFileToGoogleDrive,
} from "@/lib/google-sheets/driveUpload";
import { corsJson, corsOptions, verifyExtensionKey } from "@/lib/api/extensionCors";

export function OPTIONS() {
  return corsOptions();
}

function formatToday(): string {
  const d = new Date();
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function sheetErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Unexpected error during registration.";
}

function sheetErrorStatus(message: string): number {
  const lower = message.toLowerCase();
  if (
    lower.includes("missing") ||
    lower.includes("not set") ||
    lower.includes("invalid") ||
    lower.includes("required")
  ) {
    return 400;
  }
  if (lower.includes("unauthorized")) return 401;
  return 500;
}

export async function POST(request: NextRequest) {
  const authError = verifyExtensionKey(request);
  if (authError) {
    return corsJson({ error: authError }, { status: 401 });
  }

  try {
    const formData = await request.formData();
    const jobLink = String(formData.get("jobLink") ?? formData.get("job_link") ?? "").trim();
    const jobTitle = String(formData.get("jobTitle") ?? formData.get("job_title") ?? "").trim();
    const companyName = String(
      formData.get("companyName") ?? formData.get("company") ?? "",
    ).trim();
    const candidate = String(formData.get("candidate") ?? "").trim();
    const email = String(formData.get("email") ?? "").trim();
    const apply = String(formData.get("apply") ?? "Registered").trim();

    const resumeFile = formData.get("resume") as File | null;
    const coverFile = formData.get("coverLetter") as File | null;

    if (!jobLink || !jobTitle || !companyName) {
      return corsJson(
        { error: "jobLink, jobTitle, and companyName are required." },
        { status: 400 },
      );
    }

    if (!resumeFile || resumeFile.size === 0) {
      return corsJson({ error: "resume file is required." }, { status: 400 });
    }

    const entryId = newEntryId();
    const resumeBuffer = Buffer.from(await resumeFile.arrayBuffer());
    const resumeUpload = await uploadFileToGoogleDrive(
      resumeBuffer,
      buildUniqueFileName(entryId, "resume", resumeFile.name || "resume.pdf"),
      resumeFile.type || guessMimeType(resumeFile.name),
    );

    let coverLetterUrl = "";
    if (coverFile && coverFile.size > 0) {
      const coverBuffer = Buffer.from(await coverFile.arrayBuffer());
      const coverUpload = await uploadFileToGoogleDrive(
        coverBuffer,
        buildUniqueFileName(
          entryId,
          "cover",
          coverFile.name || "cover_letter.pdf",
        ),
        coverFile.type || guessMimeType(coverFile.name),
      );
      coverLetterUrl = coverUpload.webViewLink;
    }

    const { rowIndex } = await appendResumeDbEntry({
      entryId,
      candidate,
      email,
      jobLink,
      apply,
      jobTitle,
      company: companyName,
      resumeUrl: resumeUpload.webViewLink,
      coverLetterUrl,
      date: formatToday(),
    });

    return corsJson(
      {
        ok: true,
        entryId,
        rowIndex,
        jobLink,
        jobTitle,
        companyName,
        resumeUrl: resumeUpload.webViewLink,
        coverLetterUrl,
        resumeFileName: resumeUpload.fileName,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Resume DB register error:", error);
    const message = sheetErrorMessage(error);
    return corsJson({ error: message }, { status: sheetErrorStatus(message) });
  }
}
