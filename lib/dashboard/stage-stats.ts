import { atsPlatformFromLink } from "@/lib/ats-platform";
import { getDayKeyInTimeZone } from "@/lib/timezone";

/** The board's Applied column: cards in the `jobs` table, whatever the column order. */
export const APPLIED_STAGE_ID = "applied";

/**
 * One registered application, reduced to what the stage statistics need. Sent to
 * the browser once, so any period, grouping or filter is computed instantly there.
 */
export type StageStatRow = {
  /** Applied (registered) at, ISO. */
  at: string;
  /** That moment's calendar day in the user's time zone (YYYY-MM-DD). */
  d: string;
  /** Profile key ("profile-12" or "name-…") and its label. */
  p: string;
  pl: string;
  /** ATS platform ("Greenhouse", …, "Company sites"). */
  ats: string;
  /** Pipeline columns this application has been in, in any order. */
  v: string[];
};

export type StageStatStage = { id: string; name: string };

export type StageStatGroupBy = "profile" | "ats";

export type StageStatQuery = {
  /** Calendar days (YYYY-MM-DD, user's time zone) the applications were sent; empty = no limit. */
  from?: string;
  to?: string;
  groupBy: StageStatGroupBy;
  /** Only this profile / platform; empty = all. */
  profile?: string;
  ats?: string;
};

export type StageStatLine = {
  key: string;
  label: string;
  applied: number;
  /** Applications that have been in each pipeline column. */
  reached: Record<string, number>;
  /** Has been in any board column, a rejection included. */
  responded: number;
};

export type StageStatTable = {
  lines: StageStatLine[];
  total: StageStatLine;
};

/** A column that records a "no". */
export const REJECTION_STAGE_RE = /reject|declin|not selected|no offer|ghost|withdraw/i;

/**
 * Columns that count as a response: every pipeline board column, rejections
 * included (a rejection is also an answer). A job is "Applied" in Resume DB
 * while it is not on the board at all; that is the only state without a response.
 */
export function responseStageIds(stages: Array<{ id: string; name: string }>): Set<string> {
  return new Set(stages.map((stage) => stage.id));
}

/** Platform name; employers' own careers sites are counted together. */
export function stageStatPlatform(link: string | null | undefined): string {
  const name = atsPlatformFromLink(link);
  if (!name) return "No link";
  return name.includes(".") ? "Company sites" : name;
}

function emptyLine(key: string, label: string, stages: StageStatStage[]): StageStatLine {
  return {
    key,
    label,
    applied: 0,
    reached: Object.fromEntries(stages.map((stage) => [stage.id, 0])),
    responded: 0,
  };
}

/** Counts per profile or per platform for the applications sent in the period. */
export function computeStageStats(
  rows: StageStatRow[],
  stages: StageStatStage[],
  query: StageStatQuery,
  timeZone: string,
): StageStatTable {
  const known = new Set(stages.map((stage) => stage.id));
  const responseIds = responseStageIds(stages);
  const lines = new Map<string, StageStatLine>();
  const total = emptyLine("all", "All", stages);

  for (const row of rows) {
    if (query.profile && row.p !== query.profile) continue;
    if (query.ats && row.ats !== query.ats) continue;
    if (query.from || query.to) {
      const day = row.d || getDayKeyInTimeZone(row.at, timeZone);
      if (!day) continue;
      if (query.from && day < query.from) continue;
      if (query.to && day > query.to) continue;
    }
    const key = query.groupBy === "profile" ? row.p : row.ats;
    const label = query.groupBy === "profile" ? row.pl : row.ats;
    if (!lines.has(key)) lines.set(key, emptyLine(key, label, stages));
    const visited = row.v.filter((id) => known.has(id));
    const responded = visited.some((id) => responseIds.has(id));
    for (const line of [lines.get(key)!, total]) {
      line.applied += 1;
      for (const id of visited) line.reached[id] += 1;
      if (responded) line.responded += 1;
    }
  }

  return {
    lines: [...lines.values()].sort((a, b) => b.applied - a.applied || a.label.localeCompare(b.label)),
    total,
  };
}

// ── Building the rows (server) ────────────────────────────────────────────

export type StageStatApplication = {
  id?: number;
  applied_at: string;
  job_link?: string | null;
  profile_id?: number | null;
  candidate_name?: string | null;
  pipeline_stage_id?: string | null;
};

export type StageStatCard = {
  /** Text holding "Resume DB #123" markers (a card's note or description). */
  text?: string | null;
  /** The card's column now. */
  stageId: string;
  /** Column id → when the card entered it. */
  stageDates?: unknown;
};

function resumeDbIds(text: string | null | undefined): number[] {
  const out: number[] = [];
  const re = /Resume DB #(\d+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(String(text || "")))) {
    const id = Number(match[1]);
    if (!Number.isNaN(id)) out.push(id);
  }
  return out;
}

/**
 * Each application with every pipeline column it has been in: the current column
 * plus each card's stage history ("Resume DB #id" links a card to its application).
 */
export function buildStageStatRows(
  applications: StageStatApplication[],
  cards: StageStatCard[],
  profileLabels: Map<number, string>,
  timeZone: string,
): StageStatRow[] {
  // One formatter for every row; the browser then filters periods without dates maths.
  const dayFormat = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const dayOf = (iso: string) => {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? "" : dayFormat.format(date);
  };
  const visitedById = new Map<number, Set<string>>();
  const visit = (id: number, stageId: string | null | undefined) => {
    if (!stageId) return;
    if (!visitedById.has(id)) visitedById.set(id, new Set());
    visitedById.get(id)!.add(stageId);
  };
  for (const card of cards) {
    const ids = resumeDbIds(card.text);
    if (!ids.length) continue;
    const history =
      card.stageDates && typeof card.stageDates === "object" && !Array.isArray(card.stageDates)
        ? Object.keys(card.stageDates as Record<string, unknown>)
        : [];
    for (const id of ids) {
      visit(id, card.stageId);
      history.forEach((stageId) => visit(id, stageId));
    }
  }

  return applications.map((app) => {
    const visited = new Set(app.id != null ? visitedById.get(app.id) ?? [] : []);
    if (app.pipeline_stage_id) visited.add(app.pipeline_stage_id);
    const profileKey =
      app.profile_id != null
        ? `profile-${app.profile_id}`
        : app.candidate_name?.trim()
          ? `name-${encodeURIComponent(app.candidate_name.trim())}`
          : "unassigned";
    const profileLabel =
      app.profile_id != null
        ? profileLabels.get(app.profile_id) || app.candidate_name?.trim() || `Profile ${app.profile_id}`
        : app.candidate_name?.trim() || "No profile";
    return {
      at: app.applied_at,
      d: dayOf(app.applied_at),
      p: profileKey,
      pl: profileLabel,
      ats: stageStatPlatform(app.job_link),
      v: [...visited],
    };
  });
}
