const LEGAL_SUFFIX_RE = /\b(inc|llc|ltd|corp|corporation|co|company)\b/g;
const MIN_SUBSTRING_LEN = 4;
/** A short name ("IBM", "SAP") still matches a longer one that starts with it as a whole word. */
const MIN_PREFIX_LEN = 3;
const STOP_WORDS = new Set(["the", "and", "of", "at", "for"]);
/** Words many unrelated companies share; two of them in common prove nothing. */
const GENERIC_WORDS = new Set([
  "group", "solutions", "solution", "systems", "technologies", "technology", "tech", "services",
  "global", "data", "labs", "software", "consulting", "partners", "holdings", "international",
  "digital", "health", "healthcare", "financial", "enterprises", "industries", "network", "networks",
  "cloud", "ai", "analytics", "media", "capital", "management", "resources", "national", "american",
]);

export type CompanyMatchLevel = "none" | "definite" | "possible";

export function normalizeCompanyName(value: string | null | undefined): string {
  let name = (value ?? "")
    .toLowerCase()
    // "Johnson & Johnson" is "Johnson and Johnson"; "AT&T" is "AT and T".
    .replace(/\s*&\s*/g, " and ")
    .replace(/[.,]/g, " ")
    .replace(LEGAL_SUFFIX_RE, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (name.startsWith("the ")) {
    name = name.slice(4).trim();
  }

  return name;
}

export function companiesMatch(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const left = normalizeCompanyName(a);
  const right = normalizeCompanyName(b);
  if (!left || !right) return false;
  if (left === right) return true;
  const [shorter, longer] = left.length <= right.length ? [left, right] : [right, left];
  if (shorter.length < MIN_PREFIX_LEN) return false;
  // Whole leading words only: "meta" is "meta platforms", never "metabase";
  // "ibm" is "ibm consulting".
  if (longer.startsWith(`${shorter} `)) return true;
  if (shorter.length < MIN_SUBSTRING_LEN) return false;
  // The same letters, spaced differently: "cvshealth" is "cvs health".
  // "and" may be written "&" or left out: "babcockwilcox" is "babcock & wilcox".
  const compact = (name: string) => name.replace(/\band\b/g, "").replace(/[^a-z0-9]/g, "");
  return compact(left) === compact(right);
}

function significantTokens(value: string | null | undefined): string[] {
  return normalizeCompanyName(value)
    .split(" ")
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

export function companyMatchLevel(
  a: string | null | undefined,
  b: string | null | undefined,
): CompanyMatchLevel {
  if (companiesMatch(a, b)) return "definite";

  const tokensA = significantTokens(a);
  const tokensB = significantTokens(b);
  if (tokensA.length === 0 || tokensB.length === 0) return "none";

  const setB = new Set(tokensB);
  // Shared generic words ("Cloud Software Group" / "Cloud Solutions Group") do not count.
  const overlap = tokensA.filter((token) => setB.has(token));
  if (overlap.length >= 2 && overlap.some((token) => !GENERIC_WORDS.has(token))) return "possible";

  const [smaller, larger] =
    tokensA.length <= tokensB.length ? [tokensA, tokensB] : [tokensB, tokensA];
  const largerSet = new Set(larger);
  if (
    smaller.length >= 2 &&
    smaller.some((token) => !GENERIC_WORDS.has(token)) &&
    smaller.every((token) => largerSet.has(token))
  ) {
    return "possible";
  }

  return "none";
}

export function companyMatchesList(
  jobCompany: string | null | undefined,
  companyList: string[],
): boolean {
  return companyList.some((company) => companiesMatch(jobCompany, company));
}

export function companyMatchLevelInList(
  jobCompany: string | null | undefined,
  companyList: string[],
): CompanyMatchLevel {
  let best: CompanyMatchLevel = "none";
  for (const company of companyList) {
    const level = companyMatchLevel(jobCompany, company);
    if (level === "definite") return "definite";
    if (level === "possible") best = "possible";
  }
  return best;
}
