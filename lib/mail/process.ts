import "server-only";

import { serverOpenAI } from "@/lib/ai/server-openai";
import { extractInterviewsFromEmails, type InterviewExtractResult } from "@/lib/interviews/process";
import { applyPendingActions } from "@/lib/mail/actions";
import { sequenceInterviewStages } from "@/lib/mail/stage-sequence";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { APPLICATION_CATEGORIES } from "@/lib/mail/categories";
import { classifyMessages, MailAiUnavailableError } from "@/lib/mail/classify";
import {
  accountProfiles,
  claimForClassification,
  listCorrectionExamples,
  listMatchCandidates,
  listPendingMessages,
  saveClassification,
  type PendingMessage,
} from "@/lib/mail/inbox-repository";
import { matchApplication, type MatchCandidate } from "@/lib/mail/match";

/** Emails per AI request, and requests running at once. */
const BATCH_SIZE = 20;
const PARALLEL_BATCHES = 4;
/** One round takes this many emails from the queue. */
const ROUND_SIZE = BATCH_SIZE * PARALLEL_BATCHES;

export type ProcessResult = {
  sorted: number;
  matched: number;
  failed: number;
  aiUnavailable?: boolean;
  /** Board updates made from sorted emails, and suggestions saved. */
  moved?: number;
  suggested?: number;
  /** Interview emails read for date, time and link. */
  interviews?: InterviewExtractResult;
};

type UserContext = {
  candidates: MatchCandidate[];
  profiles: Map<string, number | null>;
  examples: Awaited<ReturnType<typeof listCorrectionExamples>>;
};

async function sortBatch(batch: PendingMessage[], context: UserContext, result: ProcessResult): Promise<void> {
  const claimed = await claimForClassification(batch);
  const mine = batch.filter((m) => claimed.has(m.id));
  if (mine.length === 0) return;

  let sorted;
  try {
    sorted = await classifyMessages(
      mine.map((m) => ({
        id: m.id,
        fromName: m.from_name,
        fromEmail: m.from_email,
        subject: m.subject ?? "",
        snippet: m.snippet ?? "",
        receivedAt: m.received_at,
      })),
      context.examples,
    );
  } catch (error) {
    if (error instanceof MailAiUnavailableError) throw error;
    // The attempt is already counted; these emails are tried again on a later run.
    console.error("Mail sorting batch failed:", error instanceof Error ? error.message : error);
    result.failed += mine.length;
    return;
  }

  await Promise.all(
    mine.map(async (message) => {
      const verdict = sorted.get(message.id);
      if (!verdict) {
        result.failed++;
        return;
      }
      const profileId = context.profiles.get(message.account_id) ?? null;
      // A mailbox linked to a candidate only matches that candidate's applications.
      const pool = profileId === null ? context.candidates : context.candidates.filter((c) => c.profileId === profileId);
      const match = APPLICATION_CATEGORIES.includes(verdict.category)
        ? matchApplication(
            {
              fromEmail: message.from_email,
              fromName: message.from_name,
              receivedAt: message.received_at,
              company: verdict.company,
              jobTitle: verdict.jobTitle,
            },
            pool,
          )
        : null;

      await saveClassification(message.id, {
        category: verdict.category,
        confidence: verdict.confidence,
        summary: verdict.summary,
        extracted: { company: verdict.company, jobTitle: verdict.jobTitle, interviewStage: verdict.interviewStage },
        application_id: match?.applicationId ?? null,
        match_score: match?.score ?? null,
        match_reason: match?.reason ?? null,
      });
      result.sorted++;
      if (match) result.matched++;
    }),
  );
}

/**
 * Sorts and matches waiting emails, newest first, until `deadline` (ms timestamp) is near.
 * `userId` limits it to one user (the Inbox page); null takes everyone's (the timer).
 */
export async function processPendingMessages(userId: string | null, deadline: number): Promise<ProcessResult> {
  const result = await sortPendingMessages(userId, deadline);
  // Interview emails: date, time and link into the Calendar.
  try {
    result.interviews = await extractInterviewsFromEmails(userId, deadline);
  } catch (error) {
    console.error("Reading interview emails failed:", error instanceof Error ? error.message : error);
  }
  // Stages in order (first call = Screening), before the board uses them.
  try {
    for (const owner of userId ? [userId] : await mailUsers()) await sequenceInterviewStages(owner);
  } catch (error) {
    console.error("Ordering interview stages failed:", error instanceof Error ? error.message : error);
  }
  // Then the board: sorted emails that were not checked for a move yet.
  try {
    Object.assign(result, await applyPendingActions(userId, deadline));
  } catch (error) {
    console.error("Board updates from email failed:", error instanceof Error ? error.message : error);
  }
  return result;
}

/** Users with a connected mailbox (the timer works for all of them). */
async function mailUsers(): Promise<string[]> {
  const { data } = await getSupabaseAdminClient().from("mail_accounts").select("user_id");
  return [...new Set(((data ?? []) as { user_id: string }[]).map((a) => a.user_id))];
}

async function sortPendingMessages(userId: string | null, deadline: number): Promise<ProcessResult> {
  const result: ProcessResult = { sorted: 0, matched: 0, failed: 0 };
  // Checked before any email is taken, so a missing key never uses up their retries.
  if (!serverOpenAI()) return { ...result, aiUnavailable: true };
  const contexts = new Map<string, UserContext>();

  try {
    // One AI round takes up to ~15 s; do not start one that cannot finish.
    while (Date.now() < deadline - 20_000) {
      const pending = await listPendingMessages(userId, ROUND_SIZE);
      if (pending.length === 0) break;

      const byUser = new Map<string, PendingMessage[]>();
      for (const m of pending) byUser.set(m.user_id, [...(byUser.get(m.user_id) ?? []), m]);

      const batches: Promise<void>[] = [];
      for (const [owner, messages] of byUser) {
        let context = contexts.get(owner);
        if (!context) {
          const [candidates, profiles, examples] = await Promise.all([
            listMatchCandidates(owner),
            accountProfiles(owner),
            listCorrectionExamples(owner),
          ]);
          context = { candidates, profiles, examples };
          contexts.set(owner, context);
        }
        for (let i = 0; i < messages.length; i += BATCH_SIZE) {
          batches.push(sortBatch(messages.slice(i, i + BATCH_SIZE), context, result));
        }
      }
      const before = result.sorted + result.failed;
      await Promise.all(batches);
      // Nothing moved (every email taken by another run): stop rather than spin.
      if (result.sorted + result.failed === before) break;
    }
  } catch (error) {
    if (error instanceof MailAiUnavailableError) return { ...result, aiUnavailable: true };
    // Sorting never blocks syncing; what is left waits for the next run.
    console.error("Mail sorting failed:", error instanceof Error ? error.message : error);
  }
  return result;
}
