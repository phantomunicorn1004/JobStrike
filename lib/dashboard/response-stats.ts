import type { PipelineStageRow } from "@/lib/dashboard/stats";
import {
  REJECTION_STAGE_RE,
  responseStageIds,
  type StageStatRow,
} from "@/lib/dashboard/stage-stats";

/** One registered application, as loaded for the statistics. */
export type ResponseApplicationRow = {
  id?: number;
  job_link?: string | null;
  applied_at: string;
  /** Current pipeline column; null while the bid is only registered. */
  pipeline_stage_id?: string | null;
  profile_id?: number | null;
  candidate_name?: string | null;
};

export type ResponseStage = { id: string; name: string };

export type ResponseRow = {
  key: string;
  label: string;
  applied: number;
  /** Has been in any board column, a rejection included. */
  heardBack: number;
  /** For each later, non-rejection column: applications that have been in it. */
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

/**
 * How many applications got an answer, by platform and by when they were sent.
 * Works from each application's pipeline history (the same rows as the stage
 * statistics), so a job rejected after an interview still counts as reaching
 * the interview, and both cards agree.
 */
export function buildResponseStats(
  rows: StageStatRow[],
  stageRows: PipelineStageRow[],
  timeZone: string,
): ResponseStats {
  const ordered = [...stageRows].sort((a, b) => a.sort_order - b.sort_order);
  const known = new Set(ordered.map((stage) => stage.id));
  const responseIds = responseStageIds(ordered);
  const rejection = new Set(ordered.filter((stage) => REJECTION_STAGE_RE.test(stage.name)).map((stage) => stage.id));
  const progressStages = ordered
    .filter((stage) => !rejection.has(stage.id))
    .map((stage) => ({ id: stage.id, name: stage.name }));

  // One formatter for the whole run: building one per row is slow.
  const clock = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    weekday: "long",
    hourCycle: "h23",
  });

  const platforms = new Map<string, ResponseRow>();
  const blocks = new Map(TIME_BLOCKS.map((block) => [block.key, emptyRow(block.key, block.label, progressStages)]));
  const weekdays = new Map(WEEKDAYS.map((day) => [day, emptyRow(day, day, progressStages)]));
  const totals = emptyRow("all", "All platforms", progressStages);

  for (const row of rows) {
    const visited = row.v.filter((id) => known.has(id));
    const heardBack = visited.some((id) => responseIds.has(id));

    const targets: ResponseRow[] = [totals];
    if (!platforms.has(row.ats)) platforms.set(row.ats, emptyRow(row.ats, row.ats, progressStages));
    targets.push(platforms.get(row.ats)!);

    const date = new Date(row.at);
    if (!Number.isNaN(date.getTime())) {
      const parts = Object.fromEntries(clock.formatToParts(date).map((part) => [part.type, part.value]));
      let hour = Number(parts.hour) + Number(parts.minute) / 60;
      if (hour < 1) hour += 24;
      const block = TIME_BLOCKS.find((item) => hour >= item.from && hour < item.to);
      if (block) targets.push(blocks.get(block.key)!);
      if (weekdays.has(parts.weekday)) targets.push(weekdays.get(parts.weekday)!);
    }

    for (const target of targets) {
      target.applied += 1;
      if (heardBack) target.heardBack += 1;
      for (const column of progressStages) {
        if (visited.includes(column.id)) target.reached[column.id] += 1;
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
