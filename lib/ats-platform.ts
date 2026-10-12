/**
 * The applicant-tracking platform a job link belongs to ("Greenhouse",
 * "Workday", …), for showing and filtering where bids were placed. Mirrors
 * PLATFORM_RULES in jobstrike_extension/job-scraper-hiringcafe.js.
 */

/** Platform name, then the domains its job pages are served from. First match wins. */
const PLATFORM_DOMAINS: Array<[string, string[]]> = [
  ["Greenhouse", ["greenhouse.io"]],
  ["Lever", ["lever.co"]],
  ["Workday", ["myworkdayjobs.com", "myworkdaysite.com", "workday.com"]],
  ["iCIMS", ["icims.com"]],
  ["Gem", ["jobs.gem.com"]],
  ["Ashby", ["ashbyhq.com"]],
  ["Rippling", ["rippling.com", "atsrecruiting.com"]],
  ["Jobvite", ["jobvite.com"]],
  ["SmartRecruiters", ["smartrecruiters.com"]],
  ["BambooHR", ["bamboohr.com"]],
  ["Taleo", ["taleo.net"]],
  ["Indeed", ["indeed.com"]],
  ["LinkedIn", ["linkedin.com"]],
  ["Wellfound", ["wellfound.com", "angel.co"]],
  ["Recruitee", ["recruitee.com"]],
  ["Breezy", ["breezy.hr"]],
  ["Workable", ["workable.com"]],
  ["JazzHR", ["jazz.co", "applytojob.com"]],
  ["Oracle HCM", ["oraclecloud.com"]],
  ["SuccessFactors", ["successfactors.com", "sapsf.com", "successfactors.eu", "hr.cloud.sap", "jobs2web.com"]],
  ["ADP", ["adp.com"]],
  ["UKG", ["ultipro.com", "ukg.com", "ukg.net", "entertimeonline.com"]],
  ["Dayforce", ["dayforcehcm.com"]],
  ["Paylocity", ["paylocity.com"]],
  ["Paycom", ["paycomonline.net"]],
  ["Avature", ["avature.net"]],
  ["Eightfold", ["eightfold.ai"]],
  ["Njoyn", ["njoyn.com"]],
  ["Teamtailor", ["teamtailor.com"]],
  ["Pinpoint", ["pinpointhq.com"]],
  ["Paycor", ["recruitingbypaycor.com", "paycor.com"]],
  ["Personio", ["personio.com", "personio.de"]],
  ["Dover", ["dover.com"]],
  ["Jibe", ["jibeapply.com"]],
  ["isolved", ["isolvedhire.com"]],
  ["BrassRing", ["brassring.com"]],
  ["CATS", ["catsone.com"]],
  ["HiringThing", ["hiringthing.com"]],
  ["Comeet", ["comeet.com"]],
  ["JOIN", ["join.com"]],
  ["Kula", ["kula.ai"]],
  ["Recruiterflow", ["recruiterflow.com"]],
  ["JobDiva", ["jobdiva.com"]],
  ["Fountain", ["fountain.com"]],
  ["Infor", ["inforcloudsuite.com"]],
  ["RippleHire", ["ripplehire.com"]],
  ["Jobsoid", ["jobsoid.com"]],
  ["Ceipal", ["ceipal.com"]],
  ["Manatal", ["careers-page.com"]],
  ["Gusto", ["jobs.gusto.com"]],
];

/** Job-id parameters a company's own careers site carries when it shows a board's job. */
const PLATFORM_LINK_PARAMS: Record<string, string> = {
  Greenhouse: "gh_jid",
  Ashby: "ashby_jid",
};

function on(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/**
 * Platform name for a job link. A company's own careers site that shows a
 * Greenhouse or Ashby job by id ("?gh_jid=…") counts as that platform; any
 * other unknown site comes back as its hostname, and no link as "".
 */
export function atsPlatformFromLink(link: string | null | undefined): string {
  const text = String(link ?? "").trim();
  if (!text) return "";
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return "";
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  for (const [name, domains] of PLATFORM_DOMAINS) {
    if (domains.some((domain) => on(host, domain))) return name;
  }
  for (const [name, param] of Object.entries(PLATFORM_LINK_PARAMS)) {
    if (url.searchParams.has(param)) return name;
  }
  return host;
}

/**
 * SQL "ilike" patterns that pick out one platform's job links, for filtering by
 * the link itself: that also finds bids registered before the platform was
 * saved. `platform` is a name from atsPlatformFromLink, or a hostname. Returns
 * [] for a value that is neither.
 */
export function atsPlatformLinkPatterns(platform: string): string[] {
  const wanted = platform.trim().toLowerCase();
  if (!wanted) return [];
  const known = PLATFORM_DOMAINS.find(([name]) => name.toLowerCase() === wanted);
  const domains = known ? known[1] : /^[a-z0-9.-]+\.[a-z]{2,}$/.test(wanted) ? [wanted] : [];
  const patterns: string[] = [];
  for (const domain of domains) {
    // The domain itself or any subdomain of it, as the link's host.
    patterns.push(`%//${domain}%`, `%.${domain}%`);
  }
  const param = known ? PLATFORM_LINK_PARAMS[known[0]] : undefined;
  if (param) patterns.push(`%${param}=%`);
  return patterns;
}

/** How many of the given job links belong to each platform, most used first. */
export function countAtsPlatforms(links: Array<string | null | undefined>): Array<{ name: string; count: number }> {
  const counts = new Map<string, number>();
  for (const link of links) {
    const name = atsPlatformFromLink(link);
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return Array.from(counts, ([name, count]) => ({ name, count })).sort(
    (a, b) => b.count - a.count || a.name.localeCompare(b.name),
  );
}
