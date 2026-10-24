import "server-only";

import { failOn } from "@/lib/integrations/accounts-repository";
import { INTERVIEW_STAGES, type InterviewStage } from "@/lib/interviews/types";
import { interviewStageOf, resolveStageRoles, type StageRoles } from "@/lib/mail/board-rules";
import type { ApplicationResponse, ResponseStatus, ResponsesSummary } from "@/lib/mail/response-types";
import { INITIAL_SCAN_DAYS } from "@/lib/mail/sync";
import { recordPipelineEvent } from "@/lib/pipeline-events/repository";
import { listPipelineStages, setApplicationPipelineStage } from "@/lib/resume-db/pipeline-stages";
import { getApplicationById } from "@/lib/resume-db/repository";
import { fetchAllByRange } from "@/lib/supabase/fetch-all";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

type AppRow = {
  id: number;
  company: string | null;
  job_title: string | null;
  candidate_name: string | null;
  profile_id: number | null;
  applied_at: string;
  pipeline_stage_id: string | null;
  pipeline_job_id: number | null;
};

type MessageRow = {
  application_id: number;
  category: string;
  received_at: string;
  summary: string | null;
  subject: string | null;
  extracted: { interviewStage?: string | null } | null;
};

type Override = { status: ResponseStatus; stage: InterviewStage | null; updated_at: string };

const APP_COLUMNS = "id, company, job_title, candidate_name, profile_id, applied_at, pipeline_stage_id, pipeline_job_id";
const RESPONSES = new Set(["interview", "assessment", "offer", "rejection"]);
const stageIndex = (s: InterviewStage) => INTERVIEW_STAGES.indexOf(s);

function emptySummary(): ResponsesSummary {
  return {
    applied: 0,
    responded: 0,
    interviewing: 0,
    byStage: { ai_screening: 0, screening: 0, hr: 0, technical: 0, final: 0 },
    rejected: 0,
    offer: 0,
    notResponded: 0,
  };
}

/** Profiles whose mailbox is connected, and since when their applications can be judged. */
async function trackedProfiles(userId: string): Promise<Map<number | null, string>> {
  const { data, error } = await getSupabaseAdminClient().from("mail_accounts").select("profile_id, created_at").eq("user_id", userId);
  failOn(error);
  const out = new Map<number | null, string>();
  for (const a of (data ?? []) as { profile_id: number | null; created_at: string }[]) {
    // The first scan reads INITIAL_SCAN_DAYS back from connecting.
    const since = new Date(new Date(a.created_at).getTime() - INITIAL_SCAN_DAYS * 86_400_000).toISOString();
    const known = out.get(a.profile_id);
    if (!known || since < known) out.set(a.profile_id, since);
  }
  return out;
}

function trackedSince(tracked: Map<number | null, string>, app: Pick<AppRow, "profile_id">): string | undefined {
  return tracked.get(app.profile_id) ?? tracked.get(null);
}

async function loadMessages(userId: string, applicationIds: number[] | null): Promise<Map<number, MessageRow[]>> {
  const db = getSupabaseAdminClient();
  const rows: MessageRow[] = [];
  // Specific applications: a few queries of ids. All: every linked job email.
  const chunks = applicationIds ? Array.from({ length: Math.ceil(applicationIds.length / 200) }, (_, i) => applicationIds.slice(i * 200, i * 200 + 200)) : [null];
  for (const ids of chunks) {
    rows.push(
      ...(await fetchAllByRange<MessageRow>((from, to) => {
        let q = db
          .from("mail_messages")
          .select("application_id, category, received_at, summary, subject, extracted")
          .eq("user_id", userId)
          .not("application_id", "is", null)
          .in("category", ["interview", "assessment", "offer", "rejection", "confirmation", "update", "other"]);
        if (ids) q = q.in("application_id", ids);
        return q.order("received_at", { ascending: true }).range(from, to);
      })),
    );
  }
  const byApp = new Map<number, MessageRow[]>();
  for (const m of rows) byApp.set(m.application_id, [...(byApp.get(m.application_id) ?? []), m]);
  return byApp;
}

async function loadOverrides(userId: string, applicationIds: number[] | null): Promise<Map<number, Override>> {
  let q = getSupabaseAdminClient().from("application_status_overrides").select("application_id, status, stage, updated_at").eq("user_id", userId);
  if (applicationIds) q = q.in("application_id", applicationIds.length ? applicationIds : [-1]);
  const { data, error } = await q;
  // Before scripts/add-mail-calendar-integration.sql adds the table there are simply none.
  if (error) return new Map();
  return new Map(((data ?? []) as (Override & { application_id: number })[]).map((o) => [o.application_id, o]));
}

function columnStages(roles: StageRoles): Record<string, InterviewStage> {
  const out: Record<string, InterviewStage> = {};
  if (roles.screening) out[roles.screening] = "screening";
  if (roles.hr) out[roles.hr] = "hr";
  if (roles.technical) out[roles.technical] = "technical";
  if (roles.final) out[roles.final] = "final";
  return out;
}

/** One application's status from its emails, its board column and the user's own setting. */
function computeStatus(
  app: AppRow,
  list: MessageRow[],
  roles: StageRoles,
  columns: Record<string, InterviewStage>,
  override: Override | undefined,
): ApplicationResponse {
  let status: ResponseStatus = "not_responded";
  let stage: InterviewStage | null = null;
  let lastResponseAt: string | null = null;
  let lastSummary: string | null = null;
  for (const m of list) {
    if (!RESPONSES.has(m.category)) continue;
    lastResponseAt = m.received_at;
    lastSummary = m.summary ?? m.subject;
    if (m.category === "rejection") status = "rejected";
    else if (m.category === "offer") status = "offer";
    else {
      // An interview after a rejection (another round, reopened) counts again.
      if (status !== "offer") status = "interviewing";
      const s = interviewStageOf(m.extracted?.interviewStage, `${m.subject ?? ""} ${m.summary ?? ""}`);
      if (stage === null || stageIndex(s) > stageIndex(stage)) stage = s;
    }
  }
  // Board moves made by hand are responses too.
  const column = app.pipeline_stage_id ?? (app.pipeline_job_id ? "applied" : null);
  if (column && column === roles.reject && status !== "offer") status = "rejected";
  else if (column && columns[column] && status === "not_responded") {
    status = "interviewing";
    stage = columns[column];
  }
  // The user's own setting wins until a newer reply arrives.
  const manual = Boolean(override && (!lastResponseAt || override.updated_at >= lastResponseAt));
  if (manual && override) {
    status = override.status;
    stage = override.status === "interviewing" ? override.stage : null;
  }

  return {
    applicationId: app.id,
    company: app.company ?? "",
    jobTitle: app.job_title ?? "",
    candidateName: app.candidate_name ?? "",
    profileId: app.profile_id,
    appliedAt: app.applied_at,
    status,
    stage,
    manual,
    received: list.some((m) => m.category === "confirmation"),
    lastResponseAt,
    lastSummary,
    emails: list.length,
  };
}

/**
 * Every tracked application with its status. Tracked: its candidate has a connected mailbox and
 * it was applied for since that mailbox's first scan starts (earlier replies cannot be known).
 */
export async function listApplicationResponses(
  userId: string,
  filter: { profileId?: number | null } = {},
): Promise<{ items: ApplicationResponse[]; summary: ResponsesSummary; trackingSince: string | null }> {
  const db = getSupabaseAdminClient();
  const tracked = await trackedProfiles(userId);
  if (tracked.size === 0) return { items: [], summary: emptySummary(), trackingSince: null };

  // A mailbox without a candidate covers all of the user's applications.
  const allProfiles = tracked.has(null);
  const profileIds = [...tracked.keys()].filter((p): p is number => p !== null);
  const since = [...tracked.values()].sort()[0];

  const apps = (
    await fetchAllByRange<AppRow>((from, to) => {
      let q = db.from("resume_db_applications").select(APP_COLUMNS).eq("user_id", userId).gte("applied_at", since);
      if (filter.profileId) q = q.eq("profile_id", filter.profileId);
      else if (!allProfiles) q = q.in("profile_id", profileIds.length ? profileIds : [-1]);
      return q.range(from, to);
    })
  ).filter((a) => {
    const start = trackedSince(tracked, a);
    return start !== undefined && a.applied_at >= start;
  });
  if (apps.length === 0) return { items: [], summary: emptySummary(), trackingSince: since };

  const [byApp, overrides, stages] = await Promise.all([loadMessages(userId, null), loadOverrides(userId, null), listPipelineStages()]);
  const roles = resolveStageRoles(stages);
  const columns = columnStages(roles);

  const summary = emptySummary();
  const items = apps.map((app) => {
    const item = computeStatus(app, byApp.get(app.id) ?? [], roles, columns, overrides.get(app.id));
    summary.applied++;
    if (item.status === "not_responded") summary.notResponded++;
    else summary.responded++;
    if (item.status === "interviewing") {
      summary.interviewing++;
      if (item.stage) summary.byStage[item.stage]++;
    }
    if (item.status === "rejected") summary.rejected++;
    if (item.status === "offer") summary.offer++;
    return item;
  });

  // Latest news first; applications without an answer after them, newest first.
  items.sort((a, b) => (b.lastResponseAt ?? "").localeCompare(a.lastResponseAt ?? "") || b.appliedAt.localeCompare(a.appliedAt));
  return { items, summary, trackingSince: since };
}

/** Statuses of specific applications (Resume DB rows); untracked ones are left out. */
export async function applicationResponsesFor(userId: string, ids: number[]): Promise<Record<number, ApplicationResponse>> {
  if (ids.length === 0) return {};
  const tracked = await trackedProfiles(userId);
  if (tracked.size === 0) return {};
  const { data, error } = await getSupabaseAdminClient().from("resume_db_applications").select(APP_COLUMNS).eq("user_id", userId).in("id", ids);
  failOn(error);
  const apps = ((data ?? []) as AppRow[]).filter((a) => {
    const start = trackedSince(tracked, a);
    return start !== undefined && a.applied_at >= start;
  });
  if (apps.length === 0) return {};
  const appIds = apps.map((a) => a.id);
  const [byApp, overrides, stages] = await Promise.all([loadMessages(userId, appIds), loadOverrides(userId, appIds), listPipelineStages()]);
  const roles = resolveStageRoles(stages);
  const columns = columnStages(roles);
  return Object.fromEntries(apps.map((a) => [a.id, computeStatus(a, byApp.get(a.id) ?? [], roles, columns, overrides.get(a.id))]));
}

/**
 * The user sets an application's status. Interview stages and Rejected also move its board card
 * (logged, with Undo); "not responded" leaves the board alone. `null` returns to automatic.
 */
export async function setApplicationStatus(
  userId: string,
  applicationId: number,
  value: { status: ResponseStatus; stage: InterviewStage | null } | null,
): Promise<{ ok: boolean; message: string }> {
  const app = await getApplicationById(applicationId, userId);
  if (!app) return { ok: false, message: "Application not found." };
  const db = getSupabaseAdminClient();

  if (value === null) {
    const { error } = await db.from("application_status_overrides").delete().eq("application_id", applicationId).eq("user_id", userId);
    if (error) return { ok: false, message: "Run scripts/add-mail-calendar-integration.sql in Supabase first." };
    return { ok: true, message: "Back to the status from emails." };
  }

  const { error } = await db.from("application_status_overrides").upsert(
    {
      application_id: applicationId,
      user_id: userId,
      status: value.status,
      stage: value.status === "interviewing" ? value.stage : null,
      updated_at: new Date().toISOString(),
    } as never,
    { onConflict: "application_id" },
  );
  if (error) return { ok: false, message: "Run scripts/add-mail-calendar-integration.sql in Supabase first." };

  // Keep the board in step.
  const roles = resolveStageRoles(await listPipelineStages());
  const current = app.pipelineStageId ?? (app.pipelineJobId ? "applied" : null);
  const target =
    value.status === "rejected"
      ? roles.reject
      : value.status === "offer"
        ? roles.final
        : value.status === "interviewing" && value.stage
          ? roles[value.stage === "ai_screening" ? "screening" : value.stage]
          : null;
  if (target && target !== current) {
    await setApplicationPipelineStage(applicationId, userId, target);
    await recordPipelineEvent(userId, {
      applicationId,
      fromStage: current,
      toStage: target,
      source: "manual",
      reason: "Status set in Responses",
    });
    return { ok: true, message: "Saved; the board card moved too." };
  }
  return { ok: true, message: "Saved." };
}
