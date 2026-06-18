import { NextRequest } from "next/server";
import { corsJson, corsOptions } from "@/lib/api/extensionCors";
import {
  requireRequestUser,
  resolveRequestUser,
  unauthorizedJson,
} from "@/lib/auth/resolve-request-user";
import { parseResumeFromPublicUrl } from "@/lib/resume-db/parseFromUrl";
import {
  createApplication,
  getApplicationById,
  listApplications,
  updateApplication,
} from "@/lib/resume-db/repository";
import {
  addApplicationToPipeline,
  deleteApplicationWithPipeline,
  removeApplicationFromPipeline,
} from "@/lib/resume-db/pipeline";
import {
  buildPipelineStageMap,
  listPipelineStages,
  setApplicationPipelineStage,
} from "@/lib/resume-db/pipeline-stages";
import type { ResumeDbApplicationInput } from "@/lib/resume-db/types";

export function OPTIONS() {
  return corsOptions();
}

function mapForList(
  app: Awaited<ReturnType<typeof listApplications>>[number],
  stageMap?: Map<number, string | null>,
) {
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
  const pipelineStageId = stageMap?.get(app.id) ?? null;
  return {
    id: app.id,
    rowIndex: app.id,
    entryId: app.entryId,
    profileId: app.profileId,
    candidate: app.candidateName,
    candidateName: app.candidateName,
    jobLink: app.jobLink,
    apply: app.apply,
    jobTitle: app.jobTitle,
    company: app.company,
    resumeUrl: app.resumeUrl,
    coverLetterUrl: app.coverLetterUrl,
    date,
    appliedAt: app.appliedAt,
    pipelineJobId: app.pipelineJobId,
    pipelineStageId,
    inPipeline: pipelineStageId != null,
    roleTitle: app.jobTitle || app.candidateName || `Application ${app.id}`,
  };
}

function parseEntryBody(body: Record<string, unknown>): ResumeDbApplicationInput {
  return {
    entryId: String(body.entryId ?? body.entry_id ?? "").trim(),
    profileId:
      body.profileId != null || body.profile_id != null
        ? Number(body.profileId ?? body.profile_id)
        : null,
    candidateName: String(
      body.candidateName ?? body.candidate ?? body.candidate_name ?? "",
    ).trim(),
    jobLink: String(body.jobLink ?? body.job_link ?? "").trim(),
    apply: String(body.apply ?? body.status ?? "Registered").trim(),
    jobTitle: String(body.jobTitle ?? body.job_title ?? "").trim(),
    company: String(body.company ?? body.company_name ?? "").trim(),
    resumeUrl: String(body.resumeUrl ?? body.resume_url ?? "").trim(),
    coverLetterUrl: String(
      body.coverLetterUrl ?? body.cover_letter_url ?? "",
    ).trim(),
  };
}

export async function GET(request: NextRequest) {
  try {
    const user = await resolveRequestUser(request);
    if (!user) {
      return corsJson(unauthorizedJson(), { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const idParam = searchParams.get("id");
    const shouldParse = searchParams.get("parse") === "true";

    if (idParam) {
      const id = Number(idParam);
      if (Number.isNaN(id) || id < 1) {
        return corsJson({ error: "Invalid id" }, { status: 400 });
      }

      const entry = await getApplicationById(id, user.id);
      if (!entry) {
        return corsJson({ error: "Application not found" }, { status: 404 });
      }

      if (!shouldParse) {
        return corsJson({ resume: entry });
      }

      if (!entry.resumeUrl) {
        return corsJson({ error: "This application has no resume file." }, { status: 400 });
      }

      const parsed = await parseResumeFromPublicUrl(entry.resumeUrl);
      return corsJson({
        resume: {
          ...entry,
          rowIndex: entry.id,
          content: parsed.content,
          structure: parsed.structure,
          fileName: parsed.fileName,
          fileType: parsed.fileType,
        },
      });
    }

    const entries = await listApplications(user.id);
    const [stageMap, pipelineStages] = await Promise.all([
      buildPipelineStageMap(entries),
      listPipelineStages(),
    ]);
    return corsJson({
      resumes: entries.map((entry) => mapForList(entry, stageMap)),
      pipelineStages,
    });
  } catch (error) {
    console.error("Resume DB GET error:", error);
    const message = error instanceof Error ? error.message : "Failed to load Resume DB.";
    return corsJson({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireRequestUser(request);
    const body = await request.json();
    const entry = parseEntryBody(body);

    if (!entry.jobTitle && !entry.candidateName) {
      return corsJson(
        { error: "At least job title or candidate name is required." },
        { status: 400 },
      );
    }

    if (!entry.resumeUrl) {
      return corsJson({ error: "resume_url is required." }, { status: 400 });
    }

    if (!entry.entryId) {
      const { newEntryId } = await import("@/lib/resume-db/storage");
      entry.entryId = newEntryId();
    }

    const application = await createApplication(user.id, entry);
    return corsJson({ ...mapForList(application) }, { status: 201 });
  } catch (error) {
    console.error("Resume DB POST error:", error);
    const message = error instanceof Error ? error.message : "Create failed.";
    const status = message === "Unauthorized" ? 401 : 500;
    return corsJson({ error: message }, { status });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const user = await requireRequestUser(request);
    const body = await request.json();
    const id = Number(body.rowIndex ?? body.id);
    if (Number.isNaN(id) || id < 1) {
      return corsJson({ error: "Missing or invalid id" }, { status: 400 });
    }

    const existing = await getApplicationById(id, user.id);
    if (!existing) {
      return corsJson({ error: "Application not found" }, { status: 404 });
    }

    if (typeof body.inPipeline === "boolean") {
      if (body.inPipeline) {
        await addApplicationToPipeline(id, user.id);
      } else {
        await removeApplicationFromPipeline(id, user.id);
      }
      const updated = await getApplicationById(id, user.id);
      if (!updated) {
        return corsJson({ ok: true });
      }
      const stageMap = await buildPipelineStageMap([updated]);
      return corsJson({ ok: true, ...mapForList(updated, stageMap) });
    }

    if (body.pipelineStageId !== undefined) {
      const rawStage = body.pipelineStageId;
      const stageId =
        rawStage === null || rawStage === ""
          ? null
          : String(rawStage).trim();
      await setApplicationPipelineStage(id, user.id, stageId);
      const updated = await getApplicationById(id, user.id);
      if (!updated) {
        return corsJson({ ok: true });
      }
      const stageMap = await buildPipelineStageMap([updated]);
      return corsJson({ ok: true, ...mapForList(updated, stageMap) });
    }

    const entry = parseEntryBody(body);
    if (!entry.entryId) entry.entryId = existing.entryId;

    await updateApplication(id, user.id, entry);
    const updated = await getApplicationById(id, user.id);
    if (!updated) {
      return corsJson({ ok: true });
    }
    const stageMap = await buildPipelineStageMap([updated]);
    return corsJson({ ok: true, ...mapForList(updated, stageMap) });
  } catch (error) {
    console.error("Resume DB PATCH error:", error);
    const message = error instanceof Error ? error.message : "Update failed.";
    const status = message === "Unauthorized" ? 401 : 500;
    return corsJson({ error: message }, { status });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = await requireRequestUser(request);
    const { searchParams } = new URL(request.url);
    const idParam = searchParams.get("id");
    if (!idParam) {
      return corsJson({ error: "Missing query parameter: id" }, { status: 400 });
    }

    const id = Number(idParam);
    if (Number.isNaN(id) || id < 1) {
      return corsJson({ error: "Invalid id" }, { status: 400 });
    }

    const origin = new URL(request.url).origin;
    await deleteApplicationWithPipeline(id, user.id, origin);
    return corsJson({ ok: true, id });
  } catch (error) {
    console.error("Resume DB DELETE error:", error);
    const message = error instanceof Error ? error.message : "Delete failed.";
    const status = message === "Unauthorized" ? 401 : 500;
    return corsJson({ error: message }, { status });
  }
}
