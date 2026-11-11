import { experienceKeys, fieldText, isRecord, parseKitResumeJson } from "@/lib/autogen/kit";

/**
 * Answers that differ per job, worked out on the server and sent with the job
 * to the runner, which lays them over the website profile for that one form:
 *  - current company and title: the generated resume's most recent role (the
 *    kit's real employer and title, which generation never changes);
 *  - desired salary: the pay range the posting states, answered with its middle.
 * A value that cannot be worked out is left out, so the profile's own applies.
 */

export type JobAnswers = {
  currentCompany?: string;
  currentTitle?: string;
  desiredSalary?: string;
  /** Where the salary came from, e.g. "posting: $150,000 – $180,000 per year". */
  salarySource?: string;
};

/** The most recent role in a resume JSON (experience_1, the kit's order). */
export function mostRecentRole(resumeJson: string): { company: string; title: string } | null {
  const resume = parseKitResumeJson(resumeJson);
  const work = resume && isRecord(resume.work_experience) ? resume.work_experience : null;
  const first = work ? experienceKeys(work)[0] : undefined;
  if (!work || !first) return null;
  const role = work[first] as Record<string, unknown>;
  const company = fieldText(role.company);
  const title = fieldText(role.role_title);
  return company || title ? { company, title } : null;
}

export type PostedPay = { min: number; max: number; unit: "year" | "month" | "hour"; symbol: string };

const AMOUNT = String.raw`(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s?([kK])?`;
const CURRENCY = String.raw`(?:(\$|€|£|CA\$|C\$|A\$)|(USD|CAD|GBP|EUR|AUD)\s?)`;
const RANGE_RE = new RegExp(
  String.raw`${CURRENCY}\s?${AMOUNT}(?:\s?(?:USD|CAD|GBP|EUR|AUD))?\s*(?:-|–|—|to|and)\s*(?:\$|€|£|CA\$|C\$|A\$|(?:USD|CAD|GBP|EUR|AUD)\s?)?\s?${AMOUNT}`,
  "g",
);
const HOURLY_RE = /^\s*(?:(?:usd|cad|gbp|eur|aud)\s*)?(?:\/\s*(?:hr|hour)|per\s+hour|an\s+hour|hourly)/i;
const MONTHLY_RE = /^\s*(?:(?:usd|cad|gbp|eur|aud)\s*)?(?:\/\s*(?:mo|month)|per\s+month|a\s+month|monthly)/i;

const CODE_TO_SYMBOL: Record<string, string> = { USD: "$", CAD: "CA$", GBP: "£", EUR: "€", AUD: "A$" };

function amount(digits: string, thousands: boolean): number {
  const n = Number(digits.replace(/,/g, ""));
  return thousands ? n * 1000 : n;
}

/** The first pay range the posting states, yearly, monthly or hourly; null when it states none. */
export function postedPay(jobDescription: string): PostedPay | null {
  const text = String(jobDescription || "");
  for (const match of text.matchAll(RANGE_RE)) {
    const [, symChar, symCode, minDigits, minK, maxDigits, maxK] = match;
    const symbol = symChar || CODE_TO_SYMBOL[symCode] || "$";
    // "$150-180K": the K on the second figure covers the first.
    const k = Boolean(maxK);
    let min = amount(minDigits, Boolean(minK) || (k && Number(minDigits.replace(/,/g, "")) < 1000));
    const max = amount(maxDigits, k);
    if (!(min > 0 && max >= min && max / min <= 3)) continue;
    const after = text.slice((match.index ?? 0) + match[0].length, (match.index ?? 0) + match[0].length + 20);
    if (max < 500 && HOURLY_RE.test(after)) return { min, max, unit: "hour", symbol };
    if (max < 50_000 && MONTHLY_RE.test(after)) return { min, max, unit: "month", symbol };
    if (max >= 20_000) {
      if (min < 1000) min *= 1000;
      return { min, max, unit: "year", symbol };
    }
  }
  return null;
}

function money(n: number, unit: PostedPay["unit"], symbol = "$"): string {
  return unit === "hour" ? `${symbol}${Math.round(n)}` : `${symbol}${Math.round(n).toLocaleString("en-US")}`;
}

/** The low end of the posted range: stays within the employer's budget without leaving money on the table at the midpoint. */
export function salaryAnswer(pay: PostedPay): string {
  const low = pay.min;
  const sym = pay.symbol;
  if (pay.unit === "hour") return `${money(low, "hour", sym)} per hour`;
  if (pay.unit === "month") return `${money(Math.round(low / 100) * 100, "month", sym)} per month`;
  return money(Math.round(low / 1000) * 1000, "year", sym);
}

export function jobAnswers(builtResumeJson: string, jobDescription: string): JobAnswers {
  const out: JobAnswers = {};
  const role = mostRecentRole(builtResumeJson);
  if (role?.company) out.currentCompany = role.company;
  if (role?.title) out.currentTitle = role.title;
  const pay = postedPay(jobDescription);
  if (pay) {
    out.desiredSalary = salaryAnswer(pay);
    out.salarySource = `posting: ${money(pay.min, pay.unit, pay.symbol)} – ${money(pay.max, pay.unit, pay.symbol)} per ${pay.unit}`;
  }
  return out;
}
