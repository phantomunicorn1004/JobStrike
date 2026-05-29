export type StageDates = Record<string, string>;

export function normalizeStageDates(
  raw: unknown,
  currentStageId: string,
  fallbackIso: string,
): StageDates {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const entries = Object.entries(raw as Record<string, unknown>).filter(
      ([, value]) => typeof value === "string" && value.trim(),
    ) as [string, string][];
    if (entries.length > 0) return Object.fromEntries(entries);
  }
  return { [currentStageId]: fallbackIso };
}

export function mergeStageDate(
  existing: StageDates | undefined,
  stageId: string,
  enteredAt: string,
): StageDates {
  return { ...(existing ?? {}), [stageId]: enteredAt };
}

export function toDatetimeLocalValue(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromDatetimeLocalValue(value: string): string | null {
  if (!value.trim()) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export function cardNotes(job: {
  source: "jobs" | "technical_jobs";
  note?: string;
  job_description?: string | null;
}): string {
  if (job.source === "jobs") return job.note ?? "";
  return job.job_description ?? "";
}
