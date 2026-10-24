import "server-only";

import { failOn } from "@/lib/integrations/accounts-repository";
import {
  MAIL_CATEGORIES,
  type InboxItem,
  type InboxView,
  type MailCategory,
} from "@/lib/mail/categories";
import type { CorrectionExample } from "@/lib/mail/classify";
import type { MatchCandidate } from "@/lib/mail/match";
import { fetchAllByRange } from "@/lib/supabase/fetch-all";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

const db = () => getSupabaseAdminClient();

// --- Sorting ------------------------------------------------------------------------------------

/** A failed sort is retried this often before the email is left as it is. */
export const MAX_CLASSIFY_ATTEMPTS = 3;

export type PendingMessage = {
  id: string;
  user_id: string;
  account_id: string;
  from_name: string | null;
  from_email: string;
  subject: string | null;
  snippet: string | null;
  received_at: string;
  classify_attempts: number;
};

/** Emails waiting to be sorted, newest first (most useful first). */
export async function listPendingMessages(userId: string | null, limit: number): Promise<PendingMessage[]> {
  let query = db()
    .from("mail_messages")
    .select("id, user_id, account_id, from_name, from_email, subject, snippet, received_at, classify_attempts")
    .eq("category", "unclassified")
    .lt("classify_attempts", MAX_CLASSIFY_ATTEMPTS);
  if (userId) query = query.eq("user_id", userId);
  const { data, error } = await query.order("received_at", { ascending: false }).limit(limit);
  failOn(error);
  return (data ?? []) as PendingMessage[];
}

export async function countPendingMessages(userId: string): Promise<number> {
  const { count, error } = await db()
    .from("mail_messages")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("category", "unclassified")
    .lt("classify_attempts", MAX_CLASSIFY_ATTEMPTS);
  failOn(error);
  return count ?? 0;
}

/**
 * Takes emails for one sorting batch by counting the attempt up front: an email another run took
 * meanwhile no longer has the old count and is skipped. Returns the ids this run holds.
 */
export async function claimForClassification(messages: PendingMessage[]): Promise<Set<string>> {
  const byAttempts = new Map<number, string[]>();
  for (const m of messages) byAttempts.set(m.classify_attempts, [...(byAttempts.get(m.classify_attempts) ?? []), m.id]);
  const claimed = new Set<string>();
  for (const [attempts, ids] of byAttempts) {
    const { data, error } = await db()
      .from("mail_messages")
      .update({ classify_attempts: attempts + 1 } as never)
      .in("id", ids)
      .eq("classify_attempts", attempts)
      .eq("category", "unclassified")
      .select("id");
    failOn(error);
    for (const row of (data ?? []) as { id: string }[]) claimed.add(row.id);
  }
  return claimed;
}

export type ClassificationPatch = {
  category: MailCategory;
  confidence: number;
  summary: string;
  extracted: { company: string | null; jobTitle: string | null; interviewStage?: string | null };
  application_id: number | null;
  match_score: number | null;
  match_reason: string | null;
};

export async function saveClassification(id: string, patch: ClassificationPatch): Promise<void> {
  const { error } = await db()
    .from("mail_messages")
    .update({ ...patch, classified_at: new Date().toISOString() } as never)
    .eq("id", id)
    .eq("category", "unclassified");
  failOn(error);
}

/** The user's applications, for matching. */
export async function listMatchCandidates(userId: string): Promise<MatchCandidate[]> {
  const rows = await fetchAllByRange<{
    id: number;
    profile_id: number | null;
    company: string | null;
    job_title: string | null;
    applied_at: string;
  }>((from, to) =>
    db()
      .from("resume_db_applications")
      .select("id, profile_id, company, job_title, applied_at")
      .eq("user_id", userId)
      .range(from, to),
  );
  return rows.map((r) => ({
    id: r.id,
    profileId: r.profile_id,
    company: r.company ?? "",
    jobTitle: r.job_title ?? "",
    appliedAt: r.applied_at,
  }));
}

/** Mailbox → candidate profile. */
export async function accountProfiles(userId: string): Promise<Map<string, number | null>> {
  const { data, error } = await db().from("mail_accounts").select("id, profile_id").eq("user_id", userId);
  failOn(error);
  return new Map(((data ?? []) as { id: string; profile_id: number | null }[]).map((a) => [a.id, a.profile_id]));
}

/** The user's latest corrections, as examples for the sorter. */
export async function listCorrectionExamples(userId: string, limit = 12): Promise<CorrectionExample[]> {
  const { data, error } = await db()
    .from("mail_messages")
    .select("from_email, subject, category")
    .eq("user_id", userId)
    .eq("category_source", "user")
    .order("received_at", { ascending: false })
    .limit(limit);
  failOn(error);
  return ((data ?? []) as { from_email: string; subject: string | null; category: MailCategory }[])
    .filter((r) => MAIL_CATEGORIES.includes(r.category))
    .map((r) => ({ fromEmail: r.from_email, subject: r.subject ?? "", category: r.category }));
}

// --- Ignore rules ---------------------------------------------------------------------------------

export type IgnoreRules = { senders: Set<string>; domains: Set<string> };

export async function listIgnoreRules(userId: string): Promise<IgnoreRules> {
  const { data, error } = await db().from("mail_rules").select("kind, value").eq("user_id", userId);
  // A database without the table (script not re-run yet) simply has no rules.
  if (error) return { senders: new Set(), domains: new Set() };
  const rows = (data ?? []) as { kind: string; value: string }[];
  return {
    senders: new Set(rows.filter((r) => r.kind === "ignore_sender").map((r) => r.value)),
    domains: new Set(rows.filter((r) => r.kind === "ignore_domain").map((r) => r.value)),
  };
}

/** Ignores a sender from now on and marks its emails sorted by the AI as not job-related. */
export async function ignoreSender(userId: string, fromEmail: string): Promise<number> {
  const sender = fromEmail.trim().toLowerCase();
  const { error } = await db()
    .from("mail_rules")
    .upsert({ user_id: userId, kind: "ignore_sender", value: sender } as never, {
      onConflict: "user_id,kind,value",
      ignoreDuplicates: true,
    });
  failOn(error);
  const { data, error: updateError } = await db()
    .from("mail_messages")
    .update({ category: "not_job", application_id: null, match_score: null, match_reason: null } as never)
    .eq("user_id", userId)
    .eq("from_email", sender)
    .neq("category_source", "user")
    .select("id");
  failOn(updateError);
  return (data ?? []).length;
}

// --- Inbox ----------------------------------------------------------------------------------------

const ITEM_COLUMNS =
  "id, received_at, from_name, from_email, subject, snippet, web_link, category, category_source, confidence, summary, extracted, match_score, match_reason, link_source, account_id, action, action_status, " +
  "application:resume_db_applications(id, company, job_title, candidate_name, job_link, applied_at), " +
  "account:mail_accounts(email, profile_id)";

type ItemRow = {
  id: string;
  received_at: string;
  from_name: string | null;
  from_email: string;
  subject: string | null;
  snippet: string | null;
  web_link: string | null;
  category: InboxItem["category"];
  category_source: "ai" | "user";
  confidence: number | null;
  summary: string | null;
  extracted: { company?: string | null; jobTitle?: string | null } | null;
  match_score: number | null;
  match_reason: string | null;
  link_source: "auto" | "user";
  action: InboxItem["action"];
  action_status: InboxItem["actionStatus"];
  application: {
    id: number;
    company: string | null;
    job_title: string | null;
    candidate_name: string | null;
    job_link: string | null;
    applied_at: string;
  } | null;
  account: { email: string; profile_id: number | null } | null;
};

function toItem(row: ItemRow): InboxItem {
  return {
    id: row.id,
    receivedAt: row.received_at,
    fromName: row.from_name,
    fromEmail: row.from_email,
    subject: row.subject ?? "",
    snippet: row.snippet ?? "",
    webLink: row.web_link,
    category: row.category,
    categorySource: row.category_source,
    confidence: row.confidence,
    summary: row.summary,
    company: row.extracted?.company ?? null,
    jobTitle: row.extracted?.jobTitle ?? null,
    application: row.application
      ? {
          id: row.application.id,
          company: row.application.company ?? "",
          jobTitle: row.application.job_title ?? "",
          candidateName: row.application.candidate_name ?? "",
          jobLink: row.application.job_link ?? "",
          appliedAt: row.application.applied_at,
        }
      : null,
    matchScore: row.match_score,
    matchReason: row.match_reason,
    linkSource: row.link_source,
    accountEmail: row.account?.email ?? "",
    profileId: row.account?.profile_id ?? null,
    action: row.action?.kind === "move" ? row.action : null,
    actionStatus: row.action_status,
  };
}

/** Below this, a match is shown as "check this". */
export const SURE_MATCH = 0.6;

const VIEW_CATEGORIES: Record<InboxView, MailCategory[] | null> = {
  inbox: ["interview", "assessment", "offer", "rejection", "update", "outreach", "other"],
  attention: null,
  suggested: null,
  review: ["interview", "assessment", "offer", "rejection", "update", "other"],
  interviews: ["interview", "assessment"],
  rejections: ["rejection"],
  applied: ["confirmation"],
  unmatched: ["confirmation"],
  all: null,
};

type Filters = { accountIds: string[] | null; search: string };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyView(query: any, userId: string, view: InboxView, filters: Filters) {
  let q = query.eq("user_id", userId).neq("category", "unclassified");
  const categories = VIEW_CATEGORIES[view];
  if (categories) q = q.in("category", categories);
  if (view === "review") q = q.eq("link_source", "auto");
  if (view === "unmatched") q = q.is("application_id", null);
  if (view === "suggested") q = q.eq("action_status", "suggested");
  if (filters.accountIds) {
    q = q.in("account_id", filters.accountIds.length ? filters.accountIds : ["00000000-0000-0000-0000-000000000000"]);
  }

  // At most one "or" filter per request: both conditions go into one and(...).
  const ors: string[] = [];
  if (view === "review") ors.push(`application_id.is.null,match_score.lt.${SURE_MATCH}`);
  // "Needs you": a board move to confirm, or a job email without a sure application.
  if (view === "attention") {
    ors.push(
      `action_status.eq.suggested,and(category.in.(${VIEW_CATEGORIES.review!.join(",")}),link_source.eq.auto,or(application_id.is.null,match_score.lt.${SURE_MATCH}))`,
    );
  }
  // PostgREST filter syntax: keep the search text plain.
  // (Dots may stay: only the first two of a condition separate column, operator and value.)
  const text = filters.search.replace(/[,()%*\\"]/g, " ").replace(/\s+/g, " ").trim();
  if (text) {
    ors.push(`subject.ilike.*${text}*,from_name.ilike.*${text}*,from_email.ilike.*${text}*,summary.ilike.*${text}*`);
  }
  if (ors.length === 1) q = q.or(ors[0]);
  if (ors.length === 2) q = q.or(`and(or(${ors[0]}),or(${ors[1]}))`);
  return q;
}

export async function accountIdsForProfile(userId: string, profileId: number): Promise<string[]> {
  const { data, error } = await db().from("mail_accounts").select("id").eq("user_id", userId).eq("profile_id", profileId);
  failOn(error);
  return ((data ?? []) as { id: string }[]).map((a) => a.id);
}

export async function listInboxItems(
  userId: string,
  view: InboxView,
  filters: Filters,
  page: { before: string | null; limit: number },
): Promise<{ items: InboxItem[]; hasMore: boolean }> {
  let query = applyView(db().from("mail_messages").select(ITEM_COLUMNS), userId, view, filters);
  if (page.before) query = query.lt("received_at", page.before);
  const { data, error } = await query.order("received_at", { ascending: false }).limit(page.limit + 1);
  failOn(error);
  const rows = (data ?? []) as ItemRow[];
  return { items: rows.slice(0, page.limit).map(toItem), hasMore: rows.length > page.limit };
}

export async function countInboxViews(
  userId: string,
  views: readonly InboxView[],
  filters: Filters,
): Promise<Record<InboxView, number>> {
  const entries = await Promise.all(
    views.map(async (view) => {
      const { count, error } = await applyView(
        db().from("mail_messages").select("id", { count: "exact", head: true }),
        userId,
        view,
        filters,
      );
      failOn(error);
      return [view, count ?? 0] as const;
    }),
  );
  return Object.fromEntries(entries) as Record<InboxView, number>;
}

export async function getInboxItem(userId: string, id: string): Promise<InboxItem | null> {
  const { data, error } = await db().from("mail_messages").select(ITEM_COLUMNS).eq("id", id).eq("user_id", userId).maybeSingle();
  failOn(error);
  return data ? toItem(data as unknown as ItemRow) : null;
}

export async function updateInboxItem(userId: string, id: string, patch: Record<string, unknown>): Promise<InboxItem | null> {
  const { error } = await db().from("mail_messages").update(patch as never).eq("id", id).eq("user_id", userId);
  failOn(error);
  return getInboxItem(userId, id);
}

/** Per application: when its confirmation arrived, and its latest email. For Resume DB rows. */
export async function applicationEmailStatus(
  userId: string,
  applicationIds: number[],
): Promise<Record<number, { confirmedAt: string | null; latest: { category: MailCategory; receivedAt: string; summary: string | null } | null }>> {
  if (applicationIds.length === 0) return {};
  const { data, error } = await db()
    .from("mail_messages")
    .select("application_id, category, received_at, summary")
    .eq("user_id", userId)
    .in("application_id", applicationIds)
    .neq("category", "not_job")
    .neq("category", "unclassified")
    .order("received_at", { ascending: true });
  failOn(error);
  const out: Record<number, { confirmedAt: string | null; latest: { category: MailCategory; receivedAt: string; summary: string | null } | null }> = {};
  for (const row of (data ?? []) as { application_id: number; category: MailCategory; received_at: string; summary: string | null }[]) {
    const entry = (out[row.application_id] ??= { confirmedAt: null, latest: null });
    if (row.category === "confirmation" && !entry.confirmedAt) entry.confirmedAt = row.received_at;
    entry.latest = { category: row.category, receivedAt: row.received_at, summary: row.summary };
  }
  return out;
}

/** Waiting suggestions per target column (the Inbox banner). */
export async function suggestionSummary(userId: string): Promise<{ toStage: string; count: number }[]> {
  const rows = await fetchAllByRange<{ action: { toStage?: string } | null }>((from, to) =>
    db().from("mail_messages").select("action").eq("user_id", userId).eq("action_status", "suggested").range(from, to),
  );
  const counts = new Map<string, number>();
  for (const row of rows) {
    const stage = row.action?.toStage;
    if (stage) counts.set(stage, (counts.get(stage) ?? 0) + 1);
  }
  return [...counts].map(([toStage, count]) => ({ toStage, count })).sort((a, b) => b.count - a.count);
}
