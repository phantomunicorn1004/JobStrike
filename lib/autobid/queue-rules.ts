/**
 * Auto-bid's queue rules, pure so the tests can run them: a job must be sent
 * within FRESH_HOURS of being posted, and the queue never holds more than the
 * day's remaining sends.
 */

/** A job older than this is not worth a resume or an application anymore. */
export const FRESH_HOURS = 24;

/** When the job was posted, or when Live found it when the source gives no time. */
export function jobTimeMs(postedAt: string | null | undefined, foundAt: string | null | undefined): number {
  const posted = Date.parse(String(postedAt ?? ""));
  if (Number.isFinite(posted)) return posted;
  const found = Date.parse(String(foundAt ?? ""));
  return Number.isFinite(found) ? found : Number.NaN;
}

export function isStale(postedAt: string | null | undefined, foundAt: string | null | undefined, nowMs = Date.now()): boolean {
  const at = jobTimeMs(postedAt, foundAt);
  return !Number.isFinite(at) || nowMs - at > FRESH_HOURS * 3600_000;
}

/** The oldest posting time still fresh, for queries. */
export function freshCutoffIso(nowMs = Date.now()): string {
  return new Date(nowMs - FRESH_HOURS * 3600_000).toISOString();
}

/** Jobs that may be queued now: the day's limit, less what was sent and what is already on its way. */
export function queueRoom({
  dailyLimit,
  sentToday,
  inPipeline,
}: {
  dailyLimit: number;
  sentToday: number;
  inPipeline: number;
}): number {
  return Math.max(0, Math.floor(dailyLimit) - sentToday - inPipeline);
}

/** One company per profile at a time: "Acme, Inc." and "acme" are the same company. */
export function companyKey(company: string): string {
  return String(company || "")
    .toLowerCase()
    .replace(/\b(inc|llc|ltd|corp|corporation|co|company|gmbh|plc)\b\.?/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
