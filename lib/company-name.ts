const LEGAL_SUFFIX_RE = /\b(inc|llc|ltd|corp|corporation|co|company)\b/g;
const MIN_SUBSTRING_LEN = 4;
const STOP_WORDS = new Set(["the", "and", "of", "at", "for"]);

export type CompanyMatchLevel = "none" | "definite" | "possible";

export function normalizeCompanyName(value: string | null | undefined): string {
  let name = (value ?? "")
    .toLowerCase()
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
  if (left.length < MIN_SUBSTRING_LEN || right.length < MIN_SUBSTRING_LEN) {
    return false;
  }
  return left.includes(right) || right.includes(left);
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
  const overlap = tokensA.filter((token) => setB.has(token));
  if (overlap.length >= 2) return "possible";

  const [smaller, larger] =
    tokensA.length <= tokensB.length ? [tokensA, tokensB] : [tokensB, tokensA];
  const largerSet = new Set(larger);
  if (smaller.length >= 2 && smaller.every((token) => largerSet.has(token))) {
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
