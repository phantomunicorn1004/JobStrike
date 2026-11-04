import type { ProfileAutofill } from "@/lib/resume-db/profile-autofill";

/**
 * The free first check on a job Live found, before any AI or ChatGPT time is spent
 * on it. Runs twice: on the lite row (site, title) and again once the job
 * description is known (a location only outside the U.S., clearance,
 * citizenship, sponsorship, night shift). Anything subtler (seniority,
 * occupation, a location it cannot tell) is left to the AI fit check.
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

/** Greenhouse's and Lever's European boards: roles there are for Europe. */
function isNonUsBoard(jobLink: string): boolean {
  try {
    const host = new URL(jobLink).hostname;
    return /(^|\.)eu\.greenhouse\.io$/i.test(host) || /^jobs\.eu\.lever\.co$/i.test(host);
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

/** "Night shift", "overnight shift", or hours that run through the night ("Work hours will be 11 PM-8am EST"). */
const NIGHT_SHIFT_RE =
  /\b(?:night|overnight|graveyard|third) shift\b|\b(?:9|10|11|12)(?::[0-5]0)?\s*(?:pm|p\.m\.)\s*(?:-|–|—|to|until)\s*(?:[4-9])(?::[0-5]0)?\s*(?:am|a\.m\.)/i;

/**
 * The posting's own "Location:" line (the scrapers write it at the top of every
 * description), cut before the next detail on the same line.
 */
export function postedLocation(jobDescription: string): string {
  const match = /\bLocations?:\s*([^\n#]{1,300})/i.exec(String(jobDescription || ""));
  if (!match) return "";
  return match[1]
    .split(/\b(?:Employment Type|Department|Workplace|Compensation|Salary|Team|Job Type|Remote Type)\s*:/i)[0]
    .trim();
}

/** Words that put a location in the U.S. (or open it to the U.S.). */
const US_PLACE_RE = new RegExp(
  [
    String.raw`united states`,
    String.raw`\bU\.?\s?S\.?A?\.?(?![a-z])`,
    String.raw`\bamericas?\b`,
    String.raw`north america`,
    String.raw`\b(?:anywhere|worldwide|global(?:ly)?)\b`,
    // "Austin, TX", "Billings, MT"
    String.raw`,\s*(?:A[KLRZ]|C[AOT]|D[CE]|FL|GA|HI|I[ADLN]|K[SY]|LA|M[ADEINOST]|N[CDEHJMVY]|O[HKR]|PA|RI|S[CD]|T[NX]|UT|V[AT]|W[AIVY])\b`,
    String.raw`\b(?:alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|new york|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|washington|wisconsin|wyoming)\b`,
    String.raw`\b(?:san francisco|los angeles|seattle|boston|chicago|austin|denver|atlanta|miami|dallas|houston|portland|pittsburgh|detroit|palo alto|bellevue|sunnyvale|nyc|bay area|silicon valley)\b`,
  ].join("|"),
  "i",
);

/** Countries and regions outside the U.S. ("Georgia" is left out: it is also a state). */
const NON_US_PLACE_RE =
  /\b(canada|mexico|brazil|argentina|colombia|chile|peru|latam|united kingdom|uk|england|scotland|ireland|europe|emea|eu|germany|france|spain|portugal|italy|poland|netherlands|belgium|switzerland|austria|sweden|norway|denmark|finland|estonia|latvia|lithuania|czech\w*|slovakia|slovenia|croatia|serbia|montenegro|albania|bosnia|romania|bulgaria|greece|cyprus|hungary|ukraine|moldova|armenia|azerbaijan|turkey|t[uü]rkiye|israel|egypt|morocco|nigeria|kenya|uganda|tanzania|ghana|south africa|uae|dubai|saudi arabia|qatar|india|pakistan|bangladesh|sri lanka|philippines|vietnam|thailand|malaysia|singapore|indonesia|japan|china|hong kong|taiwan|korea|australia|new zealand|apac|london|berlin|paris|madrid|barcelona|lisbon|amsterdam|dublin|warsaw|krakow|bucharest|tirana|athens|thessaloniki|nicosia|limassol|larnaca|nairobi|kampala|ontario|quebec|alberta|british columbia|toronto|vancouver|montreal|bangalore|bengaluru|hyderabad|pune|manila|tel aviv)\b/i;

/** Working hours stated in a European or Asian time zone: a role for those time zones. */
const NON_US_HOURS_RE =
  /\b(?:\d{1,2}(?::\d{2})?\s*(?:am|pm)?\s*(?:-|–|to)\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)?|hours|time|timezone|time zone)\s*\(?\s*(EET|EEST|CET|CEST|WET|GMT\s?\+\s?\d{1,2}|UTC\s?\+\s?\d{1,2}|IST|PKT|PHT|SGT|AEST)\b/i;

/**
 * The posting is only for places outside the U.S. ("Cyprus; Spain; Poland",
 * "Canada - Remote"): a U.S. candidate cannot take it. "Remote" alone, or a
 * place this cannot tell, is left to the AI fit check.
 */
export function nonUsLocation(jobDescription: string): string {
  const location = postedLocation(jobDescription);
  if (!location) return "";
  if (US_PLACE_RE.test(location)) return "";
  if (NON_US_PLACE_RE.test(location)) return location.slice(0, 80);
  // "Georgia" or "Remote" with working hours set in Europe or Asia ("2 PM to 11 PM EET").
  const zone = NON_US_HOURS_RE.exec(String(jobDescription || ""));
  return zone ? `${location.slice(0, 60)}, hours in ${zone[1].toUpperCase()}` : "";
}

export function livesInUs(profile: ScreenOptions["profile"]): boolean {
  const country = String(profile.country || "").trim();
  return !country || /^(us|usa|u\.s\.a?\.?|united states(?: of america)?|america)$/i.test(country);
}

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
  if (livesInUs(profile)) {
    const abroad = nonUsLocation(jd);
    if (abroad) return { ok: false, reason: `Outside the U.S.: "${abroad}"` };
  }
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
