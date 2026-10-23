import { normalizeCompanyName } from "@/lib/company-name";
import type { FetchedMessage } from "@/lib/mail/types";

/**
 * Cheap first pass, no AI (docs/EMAIL_CALENDAR_INTEGRATION.md, section 4.3): keeps what may be
 * about the candidate's own applications and drops everything else, so only a small part of the
 * mailbox is stored or classified. When unsure it keeps: the classifier can still say no.
 */

export type PrefilterContext = {
  /** The mailbox's own address; its own messages are never kept. */
  accountEmail: string;
  /** Companies the user applied to, from Resume DB. */
  companies: CompanyIndex;
};

export type PrefilterResult = { keep: boolean; reason: string };

/** Applicant tracking systems, scheduling and assessment tools: their mail is about applications. */
const ATS_DOMAINS = [
  "greenhouse.io", "greenhouse-mail.io", "lever.co", "hire.lever.co", "ashbyhq.com", "ashbyhq-mail.com",
  "myworkday.com", "myworkdayjobs.com", "workday.com", "icims.com", "smartrecruiters.com", "jobvite.com",
  "workable.com", "workablemail.com", "bamboohr.com", "recruitee.com", "breezy.hr", "applytojob.com",
  "jazzhr.com", "taleo.net", "successfactors.com", "successfactors.eu", "oraclecloud.com", "ultipro.com",
  "ukg.com", "ukg.net", "paylocity.com", "paycomonline.net", "adp.com", "dayforcehcm.com", "rippling.com",
  "ats.rippling.com", "gem.com", "goodtime.io", "calendly.com", "hackerrank.com", "hackerrankforwork.com",
  "codesignal.com", "codility.com", "hirevue.com", "karat.io", "karat.com", "modernhire.com", "teamtailor.com",
  "teamtailor-mail.com", "pinpointhq.com", "personio.de", "personio.com", "zohorecruit.com", "clearcompany.com",
  "csod.com", "avature.net", "eightfold.ai", "phenompeople.com", "beamery.com", "dover.com", "wellfound.com",
  "hired.com", "trakstar.com", "hiringthing.com", "comeet.co", "freshteam.com", "manatal.com", "recruiterflow.com",
  "jobappnetwork.com", "brassring.com", "kenexa.com", "paradox.ai", "olivia.paradox.ai", "fountain.com",
  "harver.com", "testgorilla.com", "criteriacorp.com", "vidcruiter.com", "spark-hire.com", "sparkhire.com",
  "interviewing.io", "coderpad.io", "byteboard.dev", "qualified.io", "talentlyft.com", "jobscore.com",
];

/** Free mail providers: a sender there says nothing about the company. */
const FREEMAIL = new Set([
  "gmail", "googlemail", "outlook", "hotmail", "live", "msn", "yahoo", "ymail", "icloud", "me", "aol",
  "proton", "protonmail", "gmx", "mail", "zoho", "yandex", "fastmail",
]);

/** Domains that usually send account or marketing mail, even for companies the user applied to. */
const SYSTEM_SUBDOMAINS = /^(accountprotection|account|accounts|security|billing|news|newsletter|marketing|promo|offers|info|email|e|em|mailer|notify|notifications|updates)\./i;

/** Codes and account links: the extension reads these live (step 4); nothing to keep. */
const VERIFICATION_RE =
  /\b(verification code|verify your (e-?mail|account|identity)|confirm your (e-?mail|account)|one[- ]time (pass(code|word)|code)|security code|activate your account|account activation|sign[- ]in code|log[- ]?in code|reset your password|password reset|your code is)\b/i;

/** Job-alert digests and recommendations: not about an application (leads come in step 10). */
const ALERT_RE =
  /\b(job alerts?|jobs? (for you|you may|you might|matching|near you)|new jobs?|recommended jobs?|jobs? recommendations?|(is|are) hiring|top jobs|similar jobs|people also (applied|viewed)|apply now|\d+\+? (new )?(jobs|opportunities|roles))\b/i;
const ALERT_SENDER_RE = /(^|[._-])(job)?alerts?([._-]|@)|jobs-listings@|jobs-noreply@linkedin\.com|jobalerts/i;

/** Said in messages about the candidate's own application. */
const APPLICATION_STATUS_RE =
  /\b(your application|application (received|status|update|viewed|was (sent|viewed|received))|thank you for (applying|your (interest|application))|we (have )?received your application|interview|candidacy)\b/i;

const STRONG_RE =
  /\b(interview(s|ing)?|application|applied|applying|candidacy|candidate|recruit(er|ers|ing|ment)|hiring (manager|team|process)|talent (acquisition|team|partner)|job offer|offer letter|offer of employment|assessment|coding (challenge|test|exercise)|technical (screen|test|interview)|phone screen|screening call|onsite|on-site|next steps?|thank you for (applying|your interest)|your (application|candidacy|profile|resume)|unfortunately|regret to inform|(not|won't) be (moving|proceeding) forward|move forward|decided to (pursue|proceed|move forward)|availability|schedule (a|your) (call|time|interview))\b/gi;
/** Marketing senders: their wording ("ace your interview") is not about an application. */
const MARKETING_SENDER_RE = /^(promo|promotions?|marketing|newsletters?|news|deals|offers|digest|hello|team|community|events|webinars?)([._+-]|@)/i;

const WEAK_RE = /\b(position|role|opportunit(y|ies)|team|career|job|hr|people operations)\b/i;

export type CompanyIndex = {
  /** Company names without spaces or punctuation ("tenmilesquare"), for matching sender domains. */
  compact: string[];
  /** Normalized names ("ten mile square"), for matching sender display names. */
  names: string[];
};

export function buildCompanyIndex(companies: Iterable<string | null | undefined>): CompanyIndex {
  const names = new Set<string>();
  for (const company of companies) {
    const name = normalizeCompanyName(company);
    if (name.length >= 3) names.add(name);
  }
  return {
    names: [...names],
    compact: [...new Set([...names].map((n) => n.replace(/\band\b/g, "").replace(/[^a-z0-9]/g, "")))].filter(
      (c) => c.length >= 3,
    ),
  };
}

function domainOf(email: string): string {
  return email.split("@")[1]?.toLowerCase().trim() ?? "";
}

/** "careers.aflac.com" → "aflac"; "mail.company.co.uk" → "company". */
function organisationLabel(domain: string): string {
  const labels = domain.split(".").filter(Boolean);
  if (labels.length < 2) return labels[0] ?? "";
  const second = labels[labels.length - 2];
  if (labels.length >= 3 && /^(co|com|org|net|ac|gov|edu)$/.test(second)) return labels[labels.length - 3];
  return second;
}

function isAtsDomain(domain: string): string | null {
  return ATS_DOMAINS.find((ats) => domain === ats || domain.endsWith(`.${ats}`)) ?? null;
}

function matchCompany(message: FetchedMessage, companies: CompanyIndex): string | null {
  const domain = domainOf(message.fromEmail);
  const label = organisationLabel(domain);
  if (label && !FREEMAIL.has(label) && !SYSTEM_SUBDOMAINS.test(domain) && label.length >= 4) {
    for (const key of companies.compact) {
      // "aflac.com" is Aflac; "tenmilesquare.com" is "Ten Mile Square Technologies".
      if (key === label || (label.length >= 6 && key.startsWith(label)) || (key.length >= 6 && label.startsWith(key))) {
        return key;
      }
    }
  }
  // "Aflac Talent Acquisition <no-reply@hire.example.com>"
  const display = normalizeCompanyName(message.fromName);
  if (display) {
    for (const name of companies.names) {
      if (name.length >= 4 && (` ${display} `).includes(` ${name} `)) return name;
    }
  }
  return null;
}

export function prefilterMessage(message: FetchedMessage, context: PrefilterContext): PrefilterResult {
  const from = message.fromEmail.toLowerCase();
  if (!from || from === context.accountEmail.toLowerCase()) return { keep: false, reason: "own message" };

  const subject = message.subject ?? "";
  const preview = message.preview ?? "";
  const text = `${subject}\n${preview}`;

  if (VERIFICATION_RE.test(subject)) return { keep: false, reason: "verification" };

  const aboutApplication = APPLICATION_STATUS_RE.test(text);
  if (!aboutApplication && (ALERT_RE.test(subject) || ALERT_SENDER_RE.test(from))) {
    return { keep: false, reason: "job alert" };
  }

  const domain = domainOf(from);
  // LinkedIn sends both: application updates (kept) and everything else (dropped).
  if (domain === "linkedin.com" || domain.endsWith(".linkedin.com")) {
    return aboutApplication ? { keep: true, reason: "linkedin application" } : { keep: false, reason: "linkedin" };
  }

  const ats = isAtsDomain(domain);
  if (ats) return { keep: true, reason: `ats:${ats}` };

  const company = matchCompany(message, context.companies);
  if (company) return { keep: true, reason: `company:${company}` };

  if (MARKETING_SENDER_RE.test(from)) return { keep: false, reason: "marketing" };

  const strongInSubject = (subject.match(STRONG_RE) ?? []).length;
  const strongInPreview = (preview.match(STRONG_RE) ?? []).length;
  if (strongInSubject > 0) return { keep: true, reason: "wording" };
  if (strongInPreview >= 2 || (strongInPreview === 1 && WEAK_RE.test(subject))) {
    return { keep: true, reason: "wording" };
  }
  return { keep: false, reason: "not job-related" };
}
