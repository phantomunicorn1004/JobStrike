import type { ProfileAutofill } from "@/lib/resume-db/profile-autofill";

/**
 * The free first check on a job Live found, before any AI or ChatGPT time is spent
 * on it. Runs twice: on the lite row (site, title) and again once the job
 * description is known (clearance, citizenship, sponsorship, night shift).
 * Anything subtler (location, seniority, occupation) is left to the AI fit check.
 */

export type ScreenSite = "Greenhouse" | "Lever" | "Ashby";

export type ScreenInput = {
  jobLink: string;
  jobTitle: string;
  /** Absent on the lite pass. */
  jobDescription?: string | null;
};

export type ScreenOptions = {
  /** Ashby drops a Submit pressed by Auto-bid, so its jobs are only queued when asked. */
  ashby: boolean;
  /** The profile's answers: what the candidate can and cannot satisfy. */
  profile: Pick<ProfileAutofill, string>;
};

export type ScreenResult = { ok: true; site: ScreenSite } | { ok: false; reason: string };

/** The site a job is applied on, from its link; "" when Auto-bid does not apply there. */
export function siteOf(jobLink: string): ScreenSite | "" {
  let host = "";
  try {
    host = new URL(jobLink).hostname.toLowerCase();
  } catch {
    return "";
  }
  const on = (domain: string) => host === domain || host.endsWith(`.${domain}`);
  if (on("greenhouse.io")) return "Greenhouse";
  if (on("lever.co")) return "Lever";
  if (on("ashbyhq.com")) return "Ashby";
  return "";
}

/** Greenhouse's European board: roles there are for Europe. */
function isNonUsBoard(jobLink: string): boolean {
  try {
    return /(^|\.)eu\.greenhouse\.io$/i.test(new URL(jobLink).hostname);
  } catch {
    return false;
  }
}

/** Titles of roles an engineer profile does not bid on. */
const EXCLUDED_TITLE_RE =
  /\b(consultant|manager|director|head of|vice president|vp|intern|internship|recruiter|sales|account executive|specialist)\b/i;

const CLEARANCE_RE = [
  /\b(active|current)\b[^.\n]{0,40}\bclearance\b/i,
  /\bmust\s+(?:hold|have|possess)\b[^.\n]{0,40}\bclearance\b/i,
  /\bTS\s*\/\s*SCI\b/i,
];

const CITIZEN_REQUIRED_RE = [
  /\b(?:must be|required to be|requires? (?:being )?a)\b[^.\n]{0,30}\bU\.?\s?S\.? citizen/i,
  /\bU\.?\s?S\.? citizenship\b[^.\n]{0,20}\brequired\b/i,
];

const NO_SPONSORSHIP_RE =
  /\b(?:not|unable to|cannot|can't|won't|will not)\b[^.\n]{0,30}\bsponsor/i;

const NIGHT_SHIFT_RE = /\bnight shift\b/i;

function holdsClearance(profile: ScreenOptions["profile"]): boolean {
  const value = String(profile.securityClearance || "").trim();
  return Boolean(value) && !/^(no|none|n\/a)$/i.test(value);
}

function isUsCitizen(profile: ScreenOptions["profile"]): boolean {
  return /\b(u\.?\s?s\.?|united states|american)\b/i.test(String(profile.citizenship || ""));
}

function needsSponsorship(profile: ScreenOptions["profile"]): boolean {
  return String(profile.sponsorshipRequirement || "").trim().toLowerCase() === "yes";
}

/** First matching line of the description, for the reason. */
function quote(text: string, patterns: RegExp[]): string {
  for (const re of patterns) {
    const match = re.exec(text);
    if (match) return match[0].replace(/\s+/g, " ").trim().slice(0, 80);
  }
  return "";
}

export function screenCandidate(job: ScreenInput, options: ScreenOptions): ScreenResult {
  const site = siteOf(job.jobLink);
  if (!site) return { ok: false, reason: "Not a site Auto-bid applies on" };
  if (site === "Ashby" && !options.ashby) return { ok: false, reason: "Ashby: queued only by hand" };
  if (isNonUsBoard(job.jobLink)) return { ok: false, reason: "European job board" };

  const titleWord = EXCLUDED_TITLE_RE.exec(job.jobTitle || "");
  if (titleWord) return { ok: false, reason: `Title: ${titleWord[0]}` };

  const jd = String(job.jobDescription || "");
  if (!jd) return { ok: true, site };

  const profile = options.profile;
  if (!holdsClearance(profile)) {
    const hit = quote(jd, CLEARANCE_RE);
    if (hit) return { ok: false, reason: `Needs a clearance: "${hit}"` };
  }
  if (!isUsCitizen(profile)) {
    const hit = quote(jd, CITIZEN_REQUIRED_RE);
    if (hit) return { ok: false, reason: `Needs U.S. citizenship: "${hit}"` };
  }
  if (needsSponsorship(profile)) {
    const hit = quote(jd, [NO_SPONSORSHIP_RE]);
    if (hit) return { ok: false, reason: `No sponsorship: "${hit}"` };
  }
  const night = quote(jd, [NIGHT_SHIFT_RE]);
  if (night) return { ok: false, reason: "Night shift" };

  return { ok: true, site };
}
