import { companyMatchLevel, normalizeCompanyName } from "@/lib/company-name";
import { organisationMatchesCompany, senderOrganisation } from "@/lib/mail/prefilter";

/**
 * Which Resume DB application an email is about (docs/EMAIL_CALENDAR_INTEGRATION.md, section 5.1):
 * the company first (from the email, or the sender's domain), then the job title, then the most
 * recent application sent before the email.
 */

export type MatchCandidate = {
  id: number;
  profileId: number | null;
  company: string;
  jobTitle: string;
  appliedAt: string;
};

export type MatchInput = {
  fromEmail: string;
  fromName: string | null;
  receivedAt: string;
  company: string | null;
  jobTitle: string | null;
};

export type MatchResult = { applicationId: number; score: number; reason: string };

/** Words that say little about which role it is. */
const TITLE_NOISE = new Set([
  "senior", "sr", "junior", "jr", "lead", "staff", "principal", "i", "ii", "iii", "iv", "1", "2", "3",
  "remote", "hybrid", "onsite", "us", "usa", "the", "and", "of", "for", "a", "an", "to", "in", "at", "with",
]);

function titleWords(title: string | null | undefined): Set<string> {
  return new Set(
    (title ?? "")
      .toLowerCase()
      .replace(/\([^)]*\)/g, " ")
      .split(/[^a-z0-9+#]+/)
      .filter((w) => w.length > 1 && !TITLE_NOISE.has(w)),
  );
}

/** Share of the shorter title's words found in the other (0–1). */
export function titleSimilarity(a: string | null | undefined, b: string | null | undefined): number {
  const x = titleWords(a);
  const y = titleWords(b);
  if (x.size === 0 || y.size === 0) return 0;
  const [small, large] = x.size <= y.size ? [x, y] : [y, x];
  let shared = 0;
  for (const w of small) if (large.has(w)) shared++;
  return shared / small.size;
}

/** An application sent a day after the email cannot be what the email is about. */
const APPLIED_AFTER_TOLERANCE_MS = 86_400_000;

export function matchApplication(input: MatchInput, candidates: MatchCandidate[]): MatchResult | null {
  const received = new Date(input.receivedAt).getTime();
  const organisation = senderOrganisation(input.fromEmail);

  type Scored = { app: MatchCandidate; company: number; how: string };
  const byCompany: Scored[] = [];
  for (const app of candidates) {
    if (new Date(app.appliedAt).getTime() > received + APPLIED_AFTER_TOLERANCE_MS) continue;
    const level = input.company ? companyMatchLevel(input.company, app.company) : "none";
    if (level === "definite") byCompany.push({ app, company: 1, how: "company" });
    else if (organisation && organisationMatchesCompany(organisation, app.company)) {
      byCompany.push({ app, company: 0.9, how: "sender domain" });
    } else if (level === "possible") byCompany.push({ app, company: 0.6, how: "similar company name" });
  }
  if (byCompany.length === 0) return null;

  const companyName = byCompany[0].app.company || normalizeCompanyName(input.company);
  const latestFirst = (a: Scored, b: Scored) =>
    new Date(b.app.appliedAt).getTime() - new Date(a.app.appliedAt).getTime();

  if (input.jobTitle) {
    const ranked = byCompany
      .map((s) => ({ ...s, title: titleSimilarity(input.jobTitle, s.app.jobTitle) }))
      .sort((a, b) => b.title - a.title || latestFirst(a, b));
    const best = ranked[0];
    if (best.title >= 0.5) {
      const tie = ranked.filter((r) => r.title === best.title).length > 1;
      return {
        applicationId: best.app.id,
        score: round(best.company * (0.6 + 0.4 * best.title) - (tie ? 0.15 : 0)),
        reason: tie
          ? `Same ${best.how} and title as several applications; picked the latest`
          : `Same ${best.how} and job title`,
      };
    }
    if (byCompany.length === 1) {
      return {
        applicationId: byCompany[0].app.id,
        score: round(byCompany[0].company * 0.55),
        reason: `Only application at ${companyName}, but the job title differs`,
      };
    }
    return null;
  }

  if (byCompany.length === 1) {
    return {
      applicationId: byCompany[0].app.id,
      score: round(byCompany[0].company * 0.75),
      reason: `Only application at ${companyName} (${byCompany[0].how})`,
    };
  }
  const latest = [...byCompany].sort(latestFirst)[0];
  return {
    applicationId: latest.app.id,
    score: round(latest.company * 0.45),
    reason: `${byCompany.length} applications at ${companyName}; picked the latest before this email`,
  };
}

function round(n: number): number {
  return Math.round(Math.max(0, Math.min(1, n)) * 100) / 100;
}
