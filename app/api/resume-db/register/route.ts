import { NextRequest } from "next/server";
import { corsJson, corsOptions } from "@/lib/api/extensionCors";
import { requireRequestUser } from "@/lib/auth/resolve-request-user";
import { isGoogleDriveConfigured } from "@/lib/google-drive/config";
import { isGoogleOAuthWebConfigured } from "@/lib/google-drive/oauth-web";
import { isUserGoogleDriveConnected } from "@/lib/google-drive/user-drive";
import {
  createApplication,
  getProfileById,
} from "@/lib/resume-db/repository";
import { resolveRegisterFiles } from "@/lib/resume-db/resolve-register-files";
import { newEntryId } from "@/lib/resume-db/storage";

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
    const origin = new URL(request.url).origin;
    const formData = await request.formData();
    const jobLink = String(formData.get("jobLink") ?? formData.get("job_link") ?? "").trim();
    const jobTitle = String(formData.get("jobTitle") ?? formData.get("job_title") ?? "").trim();
    const companyName = String(
      formData.get("companyName") ?? formData.get("company") ?? "",
    ).trim();
    const note = String(formData.get("note") ?? "").trim();
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
    const resumeIsDefault =
      String(formData.get("resumeIsDefault") ?? "") === "1" ||
      formData.get("resumeIsDefault") === "true";
    const coverIsDefault =
      String(formData.get("coverLetterIsDefault") ?? "") === "1" ||
      formData.get("coverLetterIsDefault") === "true";

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

    const entryId = newEntryId();
    const resolved = await resolveRegisterFiles({
      userId: user.id,
      origin,
      entryId,
      resumeUrlProvided,
      coverUrlProvided,
      resumeFile,
      coverFile,
      resumeIsDefault,
      coverIsDefault,
    });

    const application = await createApplication(user.id, {
      entryId,
      profileId,
      candidateName: profile.full_name,
      jobLink,
      jobTitle,
      company: companyName,
      note,
      apply: String(formData.get("apply") ?? "Registered").trim(),
      resumeUrl: resolved.resumeUrl || "",
      coverLetterUrl: resolved.coverLetterUrl,
      resumeStoragePath: resolved.resumeStoragePath,
      coverLetterStoragePath: resolved.coverStoragePath,
      resumeDriveFileId: resolved.resumeDriveFileId,
      coverDriveFileId: resolved.coverDriveFileId,
    });

    const userDriveConnected = await isUserGoogleDriveConnected(user.id);

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
        note: application.note ?? note,
        resumeUrl: application.resumeUrl,
        coverLetterUrl: application.coverLetterUrl,
        storage: resolved.storage,
        googleDrive: {
          userConnected: userDriveConnected,
          serviceAccountConfigured: isGoogleDriveConfigured(),
          oauthWebConfigured: isGoogleOAuthWebConfigured(),
        },
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Resume DB register error:", error);
    const message = error instanceof Error ? error.message : "Registration failed.";
    return corsJson({ error: message }, { status: errorStatus(message) });
  }
}
