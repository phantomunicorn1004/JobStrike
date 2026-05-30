import { NextRequest } from "next/server";
import { corsJson, corsOptions } from "@/lib/api/extensionCors";
import { requireRequestUser } from "@/lib/auth/resolve-request-user";
import {
  getApplicationById,
  updateApplication,
} from "@/lib/resume-db/repository";
import {
  buildStoragePath,
  guessContentType,
  uploadApplicationFile,
} from "@/lib/resume-db/storage";
import { syncPipelineJobFromApplication } from "@/lib/resume-db/pipeline";

export function OPTIONS() {
  return corsOptions();
}

function mapForList(app: NonNullable<Awaited<ReturnType<typeof getApplicationById>>>) {
  const applied = new Date(app.appliedAt);
  const date = Number.isNaN(applied.getTime())
    ? ""
    : applied.toLocaleString(undefined, {
        month: "numeric",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
  return {
    id: app.id,
    rowIndex: app.id,
    entryId: app.entryId,
    profileId: app.profileId,
    candidate: app.candidateName,
    jobLink: app.jobLink,
    apply: app.apply,
    jobTitle: app.jobTitle,
    company: app.company,
    resumeUrl: app.resumeUrl,
    coverLetterUrl: app.coverLetterUrl,
    date,
    appliedAt: app.appliedAt,
    pipelineJobId: app.pipelineJobId,
    inPipeline: app.pipelineJobId != null || app.apply === "In Pipeline",
  };
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireRequestUser(request);
    const formData = await request.formData();
    const id = Number(formData.get("id") ?? formData.get("rowIndex"));
    if (Number.isNaN(id) || id < 1) {
      return corsJson({ error: "Missing or invalid id" }, { status: 400 });
    }

    const existing = await getApplicationById(id, user.id);
    if (!existing) {
      return corsJson({ error: "Application not found" }, { status: 404 });
    }

    const company = String(
      formData.get("companyName") ?? formData.get("company") ?? existing.company,
    ).trim();
    const jobTitle = String(
      formData.get("jobTitle") ?? formData.get("job_title") ?? existing.jobTitle,
    ).trim();
    const jobLink = String(
      formData.get("jobLink") ?? formData.get("job_link") ?? existing.jobLink,
    ).trim();

    if (!company || !jobTitle) {
      return corsJson(
        { error: "Company and job title are required." },
        { status: 400 },
      );
    }

    let resumeUrl = existing.resumeUrl;
    let coverLetterUrl = existing.coverLetterUrl;
    let resumeStoragePath = existing.resumeStoragePath;
    let coverStoragePath = existing.coverLetterStoragePath;

    const resumeFile = formData.get("resume") as File | null;
    if (resumeFile && resumeFile.size > 0) {
      const buffer = Buffer.from(await resumeFile.arrayBuffer());
      const path = buildStoragePath(
        existing.entryId,
        "resume",
        resumeFile.name || "resume.pdf",
      );
      const upload = await uploadApplicationFile(
        buffer,
        path,
        resumeFile.type || guessContentType(resumeFile.name),
      );
      resumeUrl = upload.publicUrl;
      resumeStoragePath = upload.storagePath;
    }

    const coverFile = formData.get("coverLetter") as File | null;
    if (coverFile && coverFile.size > 0) {
      const buffer = Buffer.from(await coverFile.arrayBuffer());
      const path = buildStoragePath(
        existing.entryId,
        "cover",
        coverFile.name || "cover_letter.pdf",
      );
      const upload = await uploadApplicationFile(
        buffer,
        path,
        coverFile.type || guessContentType(coverFile.name),
      );
      coverLetterUrl = upload.publicUrl;
      coverStoragePath = upload.storagePath;
    }

    await updateApplication(id, user.id, {
      company,
      jobTitle,
      jobLink,
      resumeUrl,
      coverLetterUrl,
      resumeStoragePath: resumeStoragePath ?? undefined,
      coverLetterStoragePath: coverStoragePath ?? undefined,
    });

    await syncPipelineJobFromApplication(id, user.id);

    const updated = await getApplicationById(id, user.id);
    if (!updated) {
      return corsJson({ error: "Update failed" }, { status: 500 });
    }

    return corsJson({ ok: true, ...mapForList(updated) });
  } catch (error) {
    console.error("Resume DB update error:", error);
    const message = error instanceof Error ? error.message : "Update failed.";
    const status = message === "Unauthorized" ? 401 : 500;
    return corsJson({ error: message }, { status });
  }
}
