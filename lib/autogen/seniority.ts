/**
 * Detect job seniority from a title and adjust the kit's date ranges so
 * the career span matches the role level. Pure: no I/O.
 */

import { experienceKeys, fieldText, isRecord, parseKitResumeJson } from "@/lib/autogen/kit";

export type Seniority = "junior" | "mid" | "senior" | "lead" | "staff" | "principal";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function detectSeniority(jobTitle: string): Seniority {
  const t = (jobTitle || "").toLowerCase();
  if (/\b(intern|entry[- ]?level|junior|jr\.?|associate|apprentice)\b/.test(t)) return "junior";
  if (/\b(principal|distinguished|fellow)\b/.test(t)) return "principal";
  if (/\b(staff)\b/.test(t)) return "staff";
  if (/\b(lead|manager|director|head\b|vp\b|vice president)\b/.test(t)) return "lead";
  if (/\b(senior|sr\.?|iii|iv)\b/.test(t)) return "senior";
  if (/\b(ii)\b/.test(t)) return "mid";
  return "mid";
}

/**
 * Months each role spans, by seniority. [exp1, exp2, exp3].
 * Roles are separated by 1-month gaps.
 */
const ROLE_MONTHS: Record<Seniority, [number, number, number]> = {
  junior:    [14, 12, 8],
  mid:       [22, 18, 14],
  senior:    [37, 40, 21],
  lead:      [40, 42, 26],
  staff:     [44, 46, 36],
  principal: [50, 52, 48],
};

function monthYear(d: Date): string {
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

function addMonths(d: Date, n: number): Date {
  const result = new Date(d.getFullYear(), d.getMonth() + n, 1);
  return result;
}

export function computeDates(
  seniority: Seniority,
  roleCount: number = 3,
  now: Date = new Date(),
): Array<{ start: string; end: string }> {
  const spans = ROLE_MONTHS[seniority];
  const results: Array<{ start: string; end: string }> = [];

  let cursor = new Date(now.getFullYear(), now.getMonth(), 1);

  for (let i = 0; i < Math.min(roleCount, spans.length); i++) {
    const end = i === 0 ? "Present" : monthYear(cursor);
    const start = addMonths(cursor, -spans[i]);
    results.push({ start: monthYear(start), end });
    cursor = addMonths(start, -1);
  }

  return results;
}

function setDate(role: Record<string, unknown>, field: string, value: string) {
  const current = role[field];
  if (isRecord(current) && "text" in current) {
    (current as { text: string }).text = value;
  } else if (typeof current === "string") {
    role[field] = value;
  }
}

/**
 * Adjust the kit's experience dates to match the detected seniority of the
 * job title. Returns the modified JSON string; returns the original unchanged
 * if seniority is "senior" (the default range) or if the kit can't be parsed.
 */
export function adjustKitForSeniority(resumeJson: string, jobTitle: string): string {
  const seniority = detectSeniority(jobTitle);
  if (seniority === "senior") return resumeJson;

  const kit = parseKitResumeJson(resumeJson);
  if (!kit) return resumeJson;
  if (!isRecord(kit.work_experience)) return resumeJson;

  const work = kit.work_experience as Record<string, unknown>;
  const roles = experienceKeys(work);
  if (!roles.length) return resumeJson;

  const hasEmptyCompanies = roles.every((r) => {
    const role = work[r] as Record<string, unknown>;
    return !fieldText(role.company);
  });
  if (!hasEmptyCompanies) return resumeJson;

  const dates = computeDates(seniority, roles.length);

  for (let i = 0; i < Math.min(roles.length, dates.length); i++) {
    const role = work[roles[i]] as Record<string, unknown>;
    setDate(role, "start_date", dates[i].start);
    setDate(role, "end_date", dates[i].end);
  }

  return JSON.stringify(kit);
}
