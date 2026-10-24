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
  /** Interviews only: which round, for the board column. */
  interviewStage: InterviewStage | null;
};

import { INTERVIEW_STAGES, type InterviewStage } from "@/lib/interviews/types";

export { INTERVIEW_STAGES, type InterviewStage };

/** A user's earlier correction, shown to the model as an example. */
export type CorrectionExample = { fromEmail: string; subject: string; category: MailCategory };

const MODEL = process.env.MAIL_AI_MODEL?.trim() || "gpt-4o-mini";

const SYSTEM_PROMPT = `You sort emails in a job seeker's mailbox. For each email decide what it is about, from the candidate's point of view.

Categories:
- interview: an invitation to an interview or to schedule one, a time confirmation, reminder, reschedule or cancellation; also AI or one-way video interviews and automated screening interviews.
- assessment: an online test, coding challenge, take-home exercise or questionnaire to complete.
- offer: job offer, offer letter, verbal offer follow-up.
- rejection: the application will not move forward, the position was filled or closed for the candidate.
- update: status of an application that is neither an interview nor a decision (viewed, under review, on hold, needs a document).
- confirmation: an automatic "application received" / "thank you for applying". This is NOT a response from the employer.
- outreach: a recruiter or company contacts the candidate about a role the candidate did not apply to.
- other: job-search related but none of the above (e.g. background check, onboarding, referral).
- not_job: not about the candidate's job search (newsletters, marketing, receipts, social, account notices, job-alert digests).

Fields:
- company: the hiring company's name as people write it ("Capital One"), never the recruiting software (Greenhouse, Workday, Lever, iCIMS, Ashby, SmartRecruiters…) and never a staffing agency's client placeholder. null when unknown.
- job_title: the role exactly as named ("Senior Data Engineer"), without the requisition id or location. null when unknown.
- summary: at most 90 characters, plain and specific, e.g. "Invites to a 30-min phone screen; asks for availability this week".
- confidence: 0.0–1.0, how sure the category is.
- interview_stage (interview and assessment only, otherwise null):
  "ai_screening": an AI interviewer, one-way or asynchronous video interview, chatbot or automated screening questions (HireVue, Spark Hire, Paradox/Olivia, micro1, Apriora…);
  "screening": a first call with a recruiter or talent-acquisition person;
  "hr": an HR or hiring-manager interview;
  "technical": a technical, coding or system-design interview, or a coding test / take-home;
  "final": a final round, onsite, panel or executive interview.
  null when the email does not say.

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
            required: ["id", "category", "confidence", "company", "job_title", "summary", "interview_stage"],
            properties: {
              id: { type: "string" },
              category: { type: "string", enum: [...MAIL_CATEGORIES] },
              confidence: { type: "number" },
              company: { type: ["string", "null"] },
              job_title: { type: ["string", "null"] },
              summary: { type: "string" },
              interview_stage: { type: ["string", "null"], enum: [...INTERVIEW_STAGES, null] },
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
    results: {
      id: string;
      category: MailCategory;
      confidence: number;
      company: string | null;
      job_title: string | null;
      summary: string;
      interview_stage: InterviewStage | null;
    }[];
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
      interviewStage:
        (r.category === "interview" || r.category === "assessment") && INTERVIEW_STAGES.includes(r.interview_stage as InterviewStage)
          ? r.interview_stage
          : null,
    });
  }
  return out;
}
