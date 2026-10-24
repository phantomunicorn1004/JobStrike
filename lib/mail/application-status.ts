import "server-only";

import { failOn } from "@/lib/integrations/accounts-repository";
import { INTERVIEW_STAGES, type InterviewStage } from "@/lib/interviews/types";
import { interviewStageOf, resolveStageRoles } from "@/lib/mail/board-rules";
import type { ApplicationResponse, ResponseStatus, ResponsesSummary } from "@/lib/mail/response-types";
import { INITIAL_SCAN_DAYS } from "@/lib/mail/sync";
import { listPipelineStages } from "@/lib/resume-db/pipeline-stages";
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

const RESPONSES = new Set(["interview", "assessment", "offer", "rejection"]);
const stageIndex = (s: InterviewStage) => INTERVIEW_STAGES.indexOf(s);

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
  const empty: ResponsesSummary = {
    applied: 0,
    responded: 0,
    interviewing: 0,
    byStage: { ai_screening: 0, screening: 0, hr: 0, technical: 0, final: 0 },
    rejected: 0,
    offer: 0,
    notResponded: 0,
  };
  if (tracked.size === 0) return { items: [], summary: empty, trackingSince: null };

  // A mailbox without a candidate covers all of the user's applications.
  const allProfiles = tracked.has(null);
  const profileIds = [...tracked.keys()].filter((p): p is number => p !== null);
  const since = [...tracked.values()].sort()[0];

  const apps = await fetchAllByRange<AppRow>((from, to) => {
    let q = db
      .from("resume_db_applications")
      .select("id, company, job_title, candidate_name, profile_id, applied_at, pipeline_stage_id, pipeline_job_id")
      .eq("user_id", userId)
      .gte("applied_at", since);
    if (filter.profileId) q = q.eq("profile_id", filter.profileId);
    else if (!allProfiles) q = q.in("profile_id", profileIds.length ? profileIds : [-1]);
    return q.range(from, to);
  });
  const inWindow = apps.filter((a) => {
    const start = tracked.get(a.profile_id) ?? tracked.get(null);
    return start !== undefined && a.applied_at >= start;
  });
  if (inWindow.length === 0) return { items: [], summary: empty, trackingSince: since };

  const messages = await fetchAllByRange<MessageRow>((from, to) =>
    db
      .from("mail_messages")
      .select("application_id, category, received_at, summary, subject, extracted")
      .eq("user_id", userId)
      .not("application_id", "is", null)
      .in("category", ["interview", "assessment", "offer", "rejection", "confirmation", "update", "other"])
      .order("received_at", { ascending: true })
      .range(from, to),
  );
  const byApp = new Map<number, MessageRow[]>();
  for (const m of messages) byApp.set(m.application_id, [...(byApp.get(m.application_id) ?? []), m]);

  // Board moves made by hand are responses too.
  const roles = resolveStageRoles(await listPipelineStages());
  const columnStage: Record<string, InterviewStage> = {};
  if (roles.screening) columnStage[roles.screening] = "screening";
  if (roles.hr) columnStage[roles.hr] = "hr";
  if (roles.technical) columnStage[roles.technical] = "technical";
  if (roles.final) columnStage[roles.final] = "final";

  const summary: ResponsesSummary = { ...empty, byStage: { ...empty.byStage } };
  const items: ApplicationResponse[] = inWindow.map((app) => {
    const list = byApp.get(app.id) ?? [];
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
    const column = app.pipeline_stage_id ?? (app.pipeline_job_id ? "applied" : null);
    if (column && column === roles.reject && status !== "offer") status = "rejected";
    else if (column && columnStage[column] && status === "not_responded") {
      status = "interviewing";
      stage = columnStage[column];
    }

    summary.applied++;
    if (status === "not_responded") summary.notResponded++;
    else summary.responded++;
    if (status === "interviewing") {
      summary.interviewing++;
      if (stage) summary.byStage[stage]++;
    }
    if (status === "rejected") summary.rejected++;
    if (status === "offer") summary.offer++;

    return {
      applicationId: app.id,
      company: app.company ?? "",
      jobTitle: app.job_title ?? "",
      candidateName: app.candidate_name ?? "",
      profileId: app.profile_id,
      appliedAt: app.applied_at,
      status,
      stage,
      received: list.some((m) => m.category === "confirmation"),
      lastResponseAt,
      lastSummary,
      emails: list.length,
    };
  });

  // Latest news first; applications without an answer after them, newest first.
  items.sort((a, b) => (b.lastResponseAt ?? "").localeCompare(a.lastResponseAt ?? "") || b.appliedAt.localeCompare(a.appliedAt));
  return { items, summary, trackingSince: since };
}
