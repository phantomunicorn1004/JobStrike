/**
 * The all-in-one Auto-bid setup: one Start/Stop and the settings for the whole
 * chain (Live → AutoGen → Auto-bid → Register). Saved per user on the server;
 * the website and the JobStrike panel both edit it, and the panel on the VPS
 * runs whatever it says. Pure: shared by the API, the website and tests.
 */

export type AutobidConfig = {
  /** Start/Stop for the whole chain. */
  running: boolean;
  /** Applications are made for this profile. */
  profileId: number | null;
  profileName: string;
  /** false = dry run: fill one job, leave it open for review, then stop. */
  submit: boolean;
  /** With submit: apply to one job (sent, or left for you), then stop. A test run. */
  once: boolean;
  dailyLimit: number;
  /** ChatGPT windows AutoGen keeps generating in. */
  windows: number;
  /** Live's working hours, e.g. "10:00-20:30, 01:00-07:30"; empty = all day (the default). */
  hours: string;
  /** Minutes between HiringCafe checks. */
  everyMinutes: number;
  hiringCafe: boolean;
  jobright: boolean;
  /** HiringCafe: only jobs posted within this many hours (Jobright dates by day: 1 day). */
  freshnessHours: number;
  /** Include Ashby jobs (auto-submitted like Greenhouse and Lever). */
  ashby: boolean;
  /** Minutes between two applications, picked at random in this range: a person's pace. */
  gapMin: number;
  gapMax: number;
  /** Raised by the server on every save; the panel applies a version once. */
  version: number;
  updatedAt: string | null;
  updatedBy: "web" | "panel" | "";
  /** Why it stopped by itself (dry run done), shown next to Start. */
  note: string;
};

export const DEFAULT_AUTOBID_CONFIG: AutobidConfig = {
  running: false,
  profileId: null,
  profileName: "",
  submit: false,
  once: false,
  dailyLimit: 25,
  windows: 2,
  hours: "",
  everyMinutes: 15,
  hiringCafe: true,
  jobright: true,
  freshnessHours: 3,
  ashby: true,
  gapMin: 1,
  gapMax: 3,
  version: 0,
  updatedAt: null,
  updatedBy: "",
  note: "",
};

export const LIMITS = {
  dailyLimit: [1, 200],
  windows: [1, 6],
  everyMinutes: [15, 120],
  freshnessHours: [1, 24],
  gap: [0, 30],
} as const;

function clampInt(value: unknown, [min, max]: readonly [number, number], fallback: number): number {
  // An emptied field keeps the current value (Number("") would be 0).
  if (value === null || value === undefined || String(value).trim() === "") return fallback;
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

/** "10:00-20:30, 01:00-07:30" → true; empty is allowed (always on). */
export function validHours(text: string): boolean {
  if (!text.trim()) return true;
  return text.split(/[,;]/).every((part) => {
    const m = part.trim().match(/^(\d{1,2}):?(\d{2})?\s*[-–]\s*(\d{1,2}):?(\d{2})?$/);
    if (!m) return false;
    const from = Number(m[1]) * 60 + Number(m[2] || 0);
    const to = Number(m[3]) * 60 + Number(m[4] || 0);
    return from <= 1440 && to <= 1440 && from !== to;
  });
}

/**
 * Applies an edit to the current setup: unknown keys are dropped and numbers
 * clamped. Returns the error to show instead when the edit cannot be saved.
 */
export function mergeAutobidConfig(
  current: AutobidConfig,
  edit: Record<string, unknown>,
): { config: AutobidConfig } | { error: string } {
  const next: AutobidConfig = { ...current };
  if ("running" in edit) next.running = Boolean(edit.running);
  if ("profileId" in edit) {
    const id = Number(edit.profileId);
    next.profileId = Number.isInteger(id) && id > 0 ? id : null;
  }
  if ("profileName" in edit) next.profileName = String(edit.profileName ?? "").slice(0, 120);
  if ("submit" in edit) next.submit = Boolean(edit.submit);
  if ("once" in edit) next.once = Boolean(edit.once);
  if ("dailyLimit" in edit) next.dailyLimit = clampInt(edit.dailyLimit, LIMITS.dailyLimit, current.dailyLimit);
  if ("windows" in edit) next.windows = clampInt(edit.windows, LIMITS.windows, current.windows);
  if ("everyMinutes" in edit) next.everyMinutes = clampInt(edit.everyMinutes, LIMITS.everyMinutes, current.everyMinutes);
  if ("hiringCafe" in edit) next.hiringCafe = Boolean(edit.hiringCafe);
  if ("jobright" in edit) next.jobright = Boolean(edit.jobright);
  if ("freshnessHours" in edit) {
    next.freshnessHours = clampInt(edit.freshnessHours, LIMITS.freshnessHours, current.freshnessHours);
  }
  if ("ashby" in edit) next.ashby = Boolean(edit.ashby);
  if ("gapMin" in edit) next.gapMin = clampInt(edit.gapMin, LIMITS.gap, current.gapMin);
  if ("gapMax" in edit) next.gapMax = clampInt(edit.gapMax, LIMITS.gap, current.gapMax);
  if (next.gapMax < next.gapMin) next.gapMax = next.gapMin;
  if ("note" in edit) next.note = String(edit.note ?? "").slice(0, 300);
  if ("hours" in edit) {
    const hours = String(edit.hours ?? "").trim();
    if (!validHours(hours)) return { error: "Hours: use the form 10:00-20:30, 01:00-07:30 (empty = all day)." };
    next.hours = hours;
  }
  if (next.running) {
    if (!next.profileId) return { error: "Choose a profile before starting." };
    if (!next.hiringCafe && !next.jobright) return { error: "Turn on HiringCafe or Jobright before starting." };
  }
  // Starting clears the last automatic-stop note.
  if (edit.running === true && !("note" in edit)) next.note = "";
  return { config: next };
}

/** A stored value (possibly from an older version) as a full setup. */
export function toAutobidConfig(value: unknown): AutobidConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ...DEFAULT_AUTOBID_CONFIG };
  const raw = value as Record<string, unknown>;
  const merged = mergeAutobidConfig({ ...DEFAULT_AUTOBID_CONFIG, running: false }, { ...raw, running: false });
  const base = "config" in merged ? merged.config : { ...DEFAULT_AUTOBID_CONFIG };
  return {
    ...base,
    // A stored "running" with a missing profile cannot run: read it as stopped.
    running: Boolean(raw.running) && Boolean(base.profileId),
    version: Number.isInteger(raw.version) ? Number(raw.version) : 0,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : null,
    updatedBy: raw.updatedBy === "web" || raw.updatedBy === "panel" ? raw.updatedBy : "",
  };
}
