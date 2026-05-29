import { NextRequest } from "next/server";
import { corsJson, corsOptions, verifyExtensionKey } from "@/lib/api/extensionCors";
import {
  createApplication,
  listProfiles,
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
    const profileIdRaw = formData.get("profileId") ?? formData.get("profile_id");
    const profileId =
      profileIdRaw != null && String(profileIdRaw).trim() !== ""
        ? Number(profileIdRaw)
        : null;

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

    if (profileId == null || Number.isNaN(profileId)) {
      return corsJson({ error: "profileId (candidate) is required." }, { status: 400 });
    }

    const profiles = await listProfiles();
    const profile = profiles.find((p) => p.id === profileId);
    if (!profile) {
      return corsJson({ error: "Selected profile not found." }, { status: 400 });
    }

    const entryId = newEntryId();
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

    let coverLetterUrl = "";
    let coverStoragePath: string | undefined;
    if (coverFile && coverFile.size > 0) {
      const coverBuffer = Buffer.from(await coverFile.arrayBuffer());
      coverStoragePath = buildStoragePath(
        entryId,
        "cover",
        coverFile.name || "cover_letter.pdf",
      );
      const coverUpload = await uploadApplicationFile(
        coverBuffer,
        coverStoragePath,
        coverFile.type || guessContentType(coverFile.name),
      );
      coverLetterUrl = coverUpload.publicUrl;
    }

    const application = await createApplication({
      entryId,
      profileId,
      candidateName: profile.full_name,
      jobLink,
      jobTitle,
      company: companyName,
      apply: String(formData.get("apply") ?? "Registered").trim(),
      resumeUrl: resumeUpload.publicUrl,
      coverLetterUrl,
      resumeStoragePath: resumeUpload.storagePath,
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
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Resume DB register error:", error);
    const message = error instanceof Error ? error.message : "Registration failed.";
    return corsJson({ error: message }, { status: errorStatus(message) });
  }
}
