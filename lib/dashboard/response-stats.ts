import { atsPlatformFromLink } from "@/lib/ats-platform";
import { getDayKeyInTimeZone, getHourInTimeZone } from "@/lib/timezone";
import type { PipelineStageRow } from "@/lib/dashboard/stats";

/** One registered application, as much as the response statistics need. */
export type ResponseApplicationRow = {
  id?: number;
  job_link?: string | null;
  applied_at: string;
  /** Current pipeline column; null while the bid is only registered. */
  pipeline_stage_id?: string | null;
};

export type ResponseStage = { id: string; name: string };

export type ResponseRow = {
  key: string;
  label: string;
  applied: number;
  /** Moved past the first pipeline column: any answer, a rejection included. */
  heardBack: number;
  /** For each later, non-rejection column: applications that got at least that far. */
  reached: Record<string, number>;
  responseRate: number;
};

export type ResponseStats = {
  /** The later pipeline columns shown as table columns, in board order. */
  stages: ResponseStage[];
  byPlatform: ResponseRow[];
  byTimeOfDay: ResponseRow[];
  byWeekday: ResponseRow[];
  totals: ResponseRow;
};

/** A column that records a "no": an answer, but not progress. */
const REJECTION_STAGE_RE = /reject|declin|decline|closed|not selected|no offer|ghost|withdraw/i;

/** Blocks of the day matching the bidding schedule (hours in the user's time zone). */
const TIME_BLOCKS: Array<{ key: string; label: string; from: number; to: number }> = [
  { key: "night", label: "1:00–7:30 AM", from: 1, to: 7.5 },
  { key: "early", label: "7:30–10:00 AM", from: 7.5, to: 10 },
  { key: "morning", label: "10:00 AM–12:30 PM", from: 10, to: 12.5 },
  { key: "afternoon", label: "12:30–8:30 PM", from: 12.5, to: 20.5 },
  { key: "late", label: "8:30 PM–1:00 AM", from: 20.5, to: 25 },
];

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function emptyRow(key: string, label: string, stages: ResponseStage[]): ResponseRow {
  return {
    key,
    label,
    applied: 0,
    heardBack: 0,
    reached: Object.fromEntries(stages.map((stage) => [stage.id, 0])),
    responseRate: 0,
  };
}

function finish(row: ResponseRow): ResponseRow {
  return {
    ...row,
    responseRate: row.applied ? Math.round((row.heardBack / row.applied) * 1000) / 10 : 0,
  };
}

/** Hours and minutes of the day, in the user's time zone, as a decimal hour (13.5 = 1:30 PM). */
function decimalHour(iso: string, timeZone: string): number {
  const hour = getHourInTimeZone(iso, timeZone);
  if (hour < 0) return -1;
  const minute = Number(
    new Intl.DateTimeFormat("en-US", { timeZone, minute: "2-digit" }).format(new Date(iso)),
  );
  return hour + (Number.isFinite(minute) ? minute / 60 : 0);
}

function timeBlockOf(iso: string, timeZone: string) {
  let hour = decimalHour(iso, timeZone);
  if (hour < 0) return null;
  if (hour < 1) hour += 24;
  return TIME_BLOCKS.find((block) => hour >= block.from && hour < block.to) ?? null;
}

function weekdayOf(iso: string, timeZone: string): string {
  const day = getDayKeyInTimeZone(iso, timeZone);
  if (!day) return "";
  // Noon UTC on that calendar day: the weekday does not depend on the zone any more.
  const index = (new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7;
  return WEEKDAYS[index];
}

/** Platform names; employers' own careers sites are counted together. */
function platformOf(link: string | null | undefined): string {
  const name = atsPlatformFromLink(link);
  if (!name) return "No link";
  return name.includes(".") ? "Company sites" : name;
}

/**
 * How many applications got an answer, by platform and by when they were sent.
 * "Heard back" means the card moved past the first pipeline column (a rejection
 * column counts as an answer); each later column counts applications that got
 * at least that far.
 */
export function buildResponseStats(
  rows: ResponseApplicationRow[],
  stageRows: PipelineStageRow[],
  timeZone: string,
): ResponseStats {
  const ordered = [...stageRows].sort((a, b) => a.sort_order - b.sort_order);
  const first = ordered[0];
  const orderOf = new Map(ordered.map((stage, index) => [stage.id, index]));
  const later = ordered.slice(1);
  const progressStages = later
    .filter((stage) => !REJECTION_STAGE_RE.test(stage.name))
    .map((stage) => ({ id: stage.id, name: stage.name }));

  const platforms = new Map<string, ResponseRow>();
  const blocks = new Map(TIME_BLOCKS.map((block) => [block.key, emptyRow(block.key, block.label, progressStages)]));
  const weekdays = new Map(WEEKDAYS.map((day) => [day, emptyRow(day, day, progressStages)]));
  const totals = emptyRow("all", "All platforms", progressStages);

  for (const row of rows) {
    const stageIndex = row.pipeline_stage_id != null ? orderOf.get(row.pipeline_stage_id) : undefined;
    const stage = stageIndex != null ? ordered[stageIndex] : undefined;
    const heardBack = stage != null && first != null && stage.id !== first.id;
    const progressed = stage != null && !REJECTION_STAGE_RE.test(stage.name);

    const targets: ResponseRow[] = [totals];
    const platform = platformOf(row.job_link);
    if (!platforms.has(platform)) platforms.set(platform, emptyRow(platform, platform, progressStages));
    targets.push(platforms.get(platform)!);
    const block = timeBlockOf(row.applied_at, timeZone);
    if (block) targets.push(blocks.get(block.key)!);
    const weekday = weekdayOf(row.applied_at, timeZone);
    if (weekday) targets.push(weekdays.get(weekday)!);

    for (const target of targets) {
      target.applied += 1;
      if (heardBack) target.heardBack += 1;
      if (progressed && stageIndex != null) {
        for (const column of progressStages) {
          if ((orderOf.get(column.id) ?? Infinity) <= stageIndex) target.reached[column.id] += 1;
        }
      }
    }
  }

  return {
    stages: progressStages,
    byPlatform: [...platforms.values()].map(finish).sort((a, b) => b.applied - a.applied),
    byTimeOfDay: TIME_BLOCKS.map((block) => finish(blocks.get(block.key)!)),
    byWeekday: WEEKDAYS.map((day) => finish(weekdays.get(day)!)),
    totals: finish(totals),
  };
}
