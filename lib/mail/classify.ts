import "server-only";

import { serverOpenAI } from "@/lib/ai/server-openai";
import { MAIL_CATEGORIES, type MailCategory } from "@/lib/mail/categories";

/**
 * AI sorting of kept emails (docs/EMAIL_CALENDAR_INTEGRATION.md, section 5.2). Only what is
 * stored is sent: sender, subject, date and the short excerpt; never whole emails.
 */

export type ClassifyInput = {
  id: string;
  fromName: string | null;
  fromEmail: string;
  subject: string;
  snippet: string;
  receivedAt: string;
};

export type Classification = {
  category: MailCategory;
  confidence: number;
  company: string | null;
  jobTitle: string | null;
  summary: string;
};

/** A user's earlier correction, shown to the model as an example. */
export type CorrectionExample = { fromEmail: string; subject: string; category: MailCategory };

const MODEL = process.env.MAIL_AI_MODEL?.trim() || "gpt-4o-mini";

const SYSTEM_PROMPT = `You sort emails in a job seeker's mailbox. For each email decide what it is about, from the candidate's point of view.

Categories:
- interview: invitation to interview, scheduling or confirming an interview time, reschedule, interview reminder, interview cancellation.
- assessment: online assessment, coding test, take-home, questionnaire, video interview recording (HackerRank, CodeSignal, HireVue…).
- offer: job offer, offer letter, verbal offer follow-up.
- rejection: the application will not move forward, position filled or closed for the candidate.
- update: status of an existing application (viewed, under review, needs more information, on hold, still interested?).
- confirmation: the application was received or submitted ("Thank you for applying").
- outreach: a recruiter or company contacts the candidate about a role the candidate did not apply to.
- other: job-search related but none of the above (e.g. background check, onboarding, referral).
- not_job: not about the candidate's job search (newsletters, marketing, receipts, social, account notices, job-alert digests).

Fields:
- company: the hiring company's name as people write it ("Capital One"), never the recruiting software (Greenhouse, Workday, Lever, iCIMS, Ashby, SmartRecruiters…) and never a staffing agency's client placeholder. null when unknown.
- job_title: the role exactly as named ("Senior Data Engineer"), without the requisition id or location. null when unknown.
- summary: at most 90 characters, plain and specific, e.g. "Invites to a 30-min phone screen; asks for availability this week".
- confidence: 0.0–1.0, how sure the category is.

Return one result per email id, in the same order.`;

const RESPONSE_FORMAT = {
  type: "json_schema" as const,
  json_schema: {
    name: "mail_classification",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["results"],
      properties: {
        results: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["id", "category", "confidence", "company", "job_title", "summary"],
            properties: {
              id: { type: "string" },
              category: { type: "string", enum: [...MAIL_CATEGORIES] },
              confidence: { type: "number" },
              company: { type: ["string", "null"] },
              job_title: { type: ["string", "null"] },
              summary: { type: "string" },
            },
          },
        },
      },
    },
  },
};

export class MailAiUnavailableError extends Error {}

function describe(item: ClassifyInput, key: string): string {
  const from = item.fromName ? `${item.fromName} <${item.fromEmail}>` : item.fromEmail;
  return [
    `### ${key}`,
    `From: ${from}`,
    `Date: ${item.receivedAt.slice(0, 10)}`,
    `Subject: ${item.subject.slice(0, 300)}`,
    `Excerpt: ${item.snippet.slice(0, 500)}`,
  ].join("\n");
}

/** Sorts up to ~20 emails in one request. Missing results are left out of the map. */
export async function classifyMessages(
  items: ClassifyInput[],
  examples: CorrectionExample[] = [],
): Promise<Map<string, Classification>> {
  const openai = serverOpenAI();
  if (!openai) throw new MailAiUnavailableError("OPENAI_API_KEY is not set.");
  if (items.length === 0) return new Map();

  // Short keys keep the request small; mapped back to message ids below.
  const keys = items.map((_, i) => `e${i + 1}`);
  const corrections =
    examples.length > 0
      ? `\n\nThe user corrected these before; sort similar emails the same way:\n${examples
          .map((e) => `- From ${e.fromEmail.split("@")[1] ?? e.fromEmail}, subject "${e.subject.slice(0, 120)}" → ${e.category}`)
          .join("\n")}`
      : "";

  const completion = await openai.chat.completions.create({
    model: MODEL,
    temperature: 0,
    response_format: RESPONSE_FORMAT,
    messages: [
      { role: "system", content: SYSTEM_PROMPT + corrections },
      { role: "user", content: items.map((item, i) => describe(item, keys[i])).join("\n\n") },
    ],
  });

  const content = completion.choices[0]?.message?.content ?? "";
  const parsed = JSON.parse(content) as {
    results: { id: string; category: MailCategory; confidence: number; company: string | null; job_title: string | null; summary: string }[];
  };

  const out = new Map<string, Classification>();
  for (const r of parsed.results ?? []) {
    const index = keys.indexOf(r.id);
    if (index < 0 || !MAIL_CATEGORIES.includes(r.category)) continue;
    out.set(items[index].id, {
      category: r.category,
      confidence: Math.max(0, Math.min(1, Number(r.confidence) || 0)),
      company: r.company?.trim() || null,
      jobTitle: r.job_title?.trim() || null,
      summary: (r.summary ?? "").trim().slice(0, 140),
    });
  }
  return out;
}
