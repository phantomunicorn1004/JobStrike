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
  countApplicationsWithFilters,
  listApplicationsWithFilters,
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
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { formatIsoInTimeZone, normalizeTimeZone } from "@/lib/timezone";

export function OPTIONS() {
  return corsOptions();
}

function mapForList(
  app: Awaited<ReturnType<typeof listApplicationsWithFilters>>[number],
  timeZone: string,
  stageMap?: Map<number, string | null>,
) {
  const date = formatIsoInTimeZone(app.appliedAt, timeZone, {
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
    const userId = user.id;
    const timeZone = normalizeTimeZone(user.timezone);

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

    const parsePage = (v: string | null) => {
      const n = Number(v ?? "");
      if (Number.isNaN(n) || n < 1) return 1;
      return Math.floor(n);
    };
    const parsePageSize = (v: string | null) => {
      const n = Number(v ?? "");
      if (Number.isNaN(n) || n < 1) return 25;
      const max = 200; // keep UI responsive
      return Math.min(max, Math.floor(n));
    };

    const page = parsePage(searchParams.get("page"));
    const pageSize = parsePageSize(searchParams.get("pageSize"));

    const search = (searchParams.get("search") ?? "").toString();
    const dateFrom = searchParams.get("dateFrom") ?? "";
    const dateTo = searchParams.get("dateTo") ?? "";
    const candidateFilter =
      searchParams.get("candidateFilter") ??
      searchParams.get("candidate") ??
      "";
    const statusFilter =
      searchParams.get("statusFilter") ??
      searchParams.get("status") ??
      "__all__";
    const sortKeyRaw = searchParams.get("sortKey") ?? "";
    const sortDir: "asc" | "desc" =
      (searchParams.get("sortDir") ?? "asc").toString() === "desc"
        ? "desc"
        : "asc";
    const includeOrphans = searchParams.get("includeOrphans") === "1";
    const sortKey =
      sortKeyRaw === "company" || sortKeyRaw === "jobTitle" || sortKeyRaw === "pipeline"
        ? (sortKeyRaw as "company" | "jobTitle" | "pipeline")
        : null;

    function parseIdsFromMarkerText(text: string | null | undefined): number[] {
      if (!text) return [];
      const out: number[] = [];
      const re = /Resume DB #(\d+)/g;
      let m: RegExpExecArray | null;
      // eslint-disable-next-line no-cond-assign
      while ((m = re.exec(text))) {
        const id = Number(m[1]);
        if (!Number.isNaN(id)) out.push(id);
      }
      return out;
    }

    async function getPipelineAppIdSets() {
      const supabase = getSupabaseAdminClient();
      const [jobsRes, techRes] = await Promise.all([
        supabase
          .from("jobs")
          .select("note")
          .eq("user_id", userId)
          .ilike("note", "%Resume DB #%"),
        supabase
          .from("technical_jobs")
          .select("stage_id, job_description")
          .eq("user_id", userId)
          .ilike("job_description", "%Resume DB #%"),
      ]);

      const appliedIds = new Set<number>();
      const technicalIdsByStage = new Map<string, Set<number>>();

      for (const row of (jobsRes.data ?? []) as { note?: string | null }[]) {
        for (const id of parseIdsFromMarkerText(row.note)) {
          appliedIds.add(id);
        }
      }

      for (const row of (techRes.data ?? []) as {
        stage_id?: string | null;
        job_description?: string | null;
      }[]) {
        const stageId = (row.stage_id ?? "technical").toString();
        if (!technicalIdsByStage.has(stageId)) technicalIdsByStage.set(stageId, new Set());
        const set = technicalIdsByStage.get(stageId)!;
        for (const id of parseIdsFromMarkerText(row.job_description)) {
          set.add(id);
        }
      }

      return { appliedIds, technicalIdsByStage };
    }

    let statusIncludeIds: number[] | undefined;
    let statusExcludeIds: number[] | undefined;

    if (statusFilter && statusFilter !== "__all__") {
      const { appliedIds, technicalIdsByStage } = await getPipelineAppIdSets();
      const unionIds = new Set<number>(appliedIds);
      for (const ids of technicalIdsByStage.values()) for (const id of ids) unionIds.add(id);

      if (statusFilter === "registered") {
        statusExcludeIds = Array.from(unionIds);
      } else if (statusFilter === "applied") {
        statusIncludeIds = Array.from(appliedIds);
      } else {
        statusIncludeIds = Array.from(technicalIdsByStage.get(statusFilter) ?? new Set());
      }
    }

    const listQuery = {
      search,
      dateFrom,
      dateTo,
      timeZone,
      candidateFilter,
      statusIncludeIds,
      statusExcludeIds,
      sortKey,
      sortDir,
      page,
      pageSize,
    };

    const total = await countApplicationsWithFilters(user.id, listQuery);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const resolvedPage = Math.min(page, totalPages);

    const entries = await listApplicationsWithFilters(user.id, {
      ...listQuery,
      page: resolvedPage,
    });

    const [stageMap, pipelineStages] = await Promise.all([
      buildPipelineStageMap(entries, user.id),
      listPipelineStages(),
    ]);

    const resumes = entries.map((entry) => mapForList(entry, timeZone, stageMap));

    // For pipeline ordering we only guarantee ordering within the loaded page.
    if (sortKey === "pipeline" && resumes.length > 0) {
      const stageSortIndex = (stageId: string | null) => {
        if (!stageId) return -1;
        const idx = pipelineStages.findIndex((stage) => stage.id === stageId);
        return idx >= 0 ? idx : pipelineStages.length + 1;
      };

      resumes.sort((a, b) => {
        const av = stageSortIndex(a.pipelineStageId);
        const bv = stageSortIndex(b.pipelineStageId);
        const cmp = av - bv;
        if (cmp !== 0) return sortDir === "asc" ? cmp : -cmp;
        return b.rowIndex - a.rowIndex;
      });
    }

    let orphanCandidateNames: string[] = [];
    if (includeOrphans) {
      const supabase = getSupabaseAdminClient();
      const { data: orphanRows } = await supabase
        .from("resume_db_applications")
        .select("candidate_name")
        .eq("user_id", userId)
        .is("profile_id", null)
        .neq("candidate_name", "")
        .order("candidate_name", { ascending: true });

      orphanCandidateNames = Array.from(
        new Set(
          (orphanRows ?? [])
            .map(
              (r: { candidate_name?: string | null }) =>
                r.candidate_name?.trim(),
            )
            .filter((x): x is string => Boolean(x)),
        ),
      );
    }

    return corsJson({
      resumes,
      pipelineStages,
      timezone: timeZone,
      total,
      page: resolvedPage,
      pageSize,
      orphanCandidateNames,
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
    const timeZone = normalizeTimeZone(user.timezone);
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
    return corsJson({ ...mapForList(application, timeZone) }, { status: 201 });
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
    const timeZone = normalizeTimeZone(user.timezone);
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
      const stageMap = await buildPipelineStageMap([updated], user.id);
      return corsJson({ ok: true, ...mapForList(updated, timeZone, stageMap) });
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
      const stageMap = await buildPipelineStageMap([updated], user.id);
      return corsJson({ ok: true, ...mapForList(updated, timeZone, stageMap) });
    }

    const entry = parseEntryBody(body);
    if (!entry.entryId) entry.entryId = existing.entryId;

    await updateApplication(id, user.id, entry);
    const updated = await getApplicationById(id, user.id);
    if (!updated) {
      return corsJson({ ok: true });
    }
    const stageMap = await buildPipelineStageMap([updated], user.id);
    return corsJson({ ok: true, ...mapForList(updated, timeZone, stageMap) });
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
