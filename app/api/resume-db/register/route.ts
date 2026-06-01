import { NextRequest } from "next/server";
import { corsJson, corsOptions } from "@/lib/api/extensionCors";
import { requireRequestUser } from "@/lib/auth/resolve-request-user";
import { isGoogleDriveConfigured } from "@/lib/google-drive/config";
import {
  createApplication,
  getProfileById,
} from "@/lib/resume-db/repository";
import {
  buildStoragePath,
  guessContentType,
  newEntryId,
  uploadApplicationFile,
} from "@/lib/resume-db/storage";

export function OPTIONS() {
  return corsOptions();
}

function errorStatus(message: string): number {
  const lower = message.toLowerCase();
  if (lower.includes("unauthorized")) return 401;
  if (lower.includes("required") || lower.includes("invalid")) return 400;
  return 500;
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireRequestUser(request);
    const formData = await request.formData();
    const jobLink = String(formData.get("jobLink") ?? formData.get("job_link") ?? "").trim();
    const jobTitle = String(formData.get("jobTitle") ?? formData.get("job_title") ?? "").trim();
    const companyName = String(
      formData.get("companyName") ?? formData.get("company") ?? "",
    ).trim();
    const profileIdRaw = formData.get("profileId") ?? formData.get("profile_id");
    const profileId =
      profileIdRaw != null && String(profileIdRaw).trim() !== ""
        ? Number(profileIdRaw)
        : null;

    const resumeUrlProvided = String(
      formData.get("resumeUrl") ?? formData.get("resume_url") ?? "",
    ).trim();
    const coverUrlProvided = String(
      formData.get("coverLetterUrl") ?? formData.get("cover_letter_url") ?? "",
    ).trim();

    const resumeFile = formData.get("resume") as File | null;
    const coverFile = formData.get("coverLetter") as File | null;

    if (!jobLink || !jobTitle || !companyName) {
      return corsJson(
        { error: "jobLink, jobTitle, and companyName are required." },
        { status: 400 },
      );
    }

    if (profileId == null || Number.isNaN(profileId)) {
      return corsJson({ error: "profileId (candidate) is required." }, { status: 400 });
    }

    const profile = await getProfileById(user.id, profileId);
    if (!profile) {
      return corsJson({ error: "Selected profile not found." }, { status: 400 });
    }

    const hasResumeFile = Boolean(resumeFile && resumeFile.size > 0);

    const entryId = newEntryId();
    let resumeUrl = resumeUrlProvided;
    let coverLetterUrl = coverUrlProvided;
    let resumeStoragePath: string | undefined;
    let coverStoragePath: string | undefined;

    if (!resumeUrl && hasResumeFile && resumeFile) {
      const resumeBuffer = Buffer.from(await resumeFile.arrayBuffer());
      const resumePath = buildStoragePath(
        entryId,
        "resume",
        resumeFile.name || "resume.pdf",
      );
      const resumeUpload = await uploadApplicationFile(
        resumeBuffer,
        resumePath,
        resumeFile.type || guessContentType(resumeFile.name),
      );
      resumeUrl = resumeUpload.publicUrl;
      resumeStoragePath = resumeUpload.storagePath;
    }

    if (!coverLetterUrl && coverFile && coverFile.size > 0) {
      const coverBuffer = Buffer.from(await coverFile.arrayBuffer());
      const coverPath = buildStoragePath(
        entryId,
        "cover",
        coverFile.name || "cover_letter.pdf",
      );
      const coverUpload = await uploadApplicationFile(
        coverBuffer,
        coverPath,
        coverFile.type || guessContentType(coverFile.name),
      );
      coverLetterUrl = coverUpload.publicUrl;
      coverStoragePath = coverUpload.storagePath;
    }

    const application = await createApplication(user.id, {
      entryId,
      profileId,
      candidateName: profile.full_name,
      jobLink,
      jobTitle,
      company: companyName,
      apply: String(formData.get("apply") ?? "Registered").trim(),
      resumeUrl: resumeUrl || "",
      coverLetterUrl,
      resumeStoragePath,
      coverLetterStoragePath: coverStoragePath,
    });

    return corsJson(
      {
        ok: true,
        id: application.id,
        rowIndex: application.id,
        entryId: application.entryId,
        profileId: application.profileId,
        candidateName: application.candidateName,
        jobLink,
        jobTitle,
        companyName,
        resumeUrl: application.resumeUrl,
        coverLetterUrl: application.coverLetterUrl,
        storage: resumeUrlProvided ? "google_drive" : "supabase",
        googleDriveConfigured: isGoogleDriveConfigured(),
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Resume DB register error:", error);
    const message = error instanceof Error ? error.message : "Registration failed.";
    return corsJson({ error: message }, { status: errorStatus(message) });
  }
}
