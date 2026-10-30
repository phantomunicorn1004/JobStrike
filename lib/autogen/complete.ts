import "server-only";

import { completeClaim } from "@/lib/autogen/claim";
import { AnswerParseError, extractBuiltResumeJson } from "@/lib/autogen/extract-json";
import { coverLetterDate, finalizeBuiltResume } from "@/lib/autogen/finalize";
import { renderGenerationPrompt } from "@/lib/autogen/prompt";
import type { ResumeDbApplication } from "@/lib/resume-db/types";
import { DEFAULT_TIMEZONE } from "@/lib/timezone";

export type GenerationEngine = "chatgpt" | "api";

export type AnswerOutcome =
  | { status: "Success"; id: number; warnings: string[]; restored: string[] }
  | {
      status: "Error";
      detail: string;
      /** Retrying with a fresh answer may help (bad JSON, missing fields). */
      retryable: boolean;
      /** The claim was lost or the kit changed: stop working on this row. */
      claimLost?: boolean;
    };

/**
 * Checks a model answer for a claimed application and saves it. On any
 * failure the row stays claimed, so the worker can retry or report it.
 */
export async function completeWithAnswer(input: {
  userId: string;
  timeZone?: string;
  application: ResumeDbApplication;
  claimedAt: string;
  answer: string;
  engine: GenerationEngine;
  meta?: Record<string, unknown>;
}): Promise<AnswerOutcome> {
  const { userId, application, claimedAt, answer, engine } = input;
  if (application.generationStatus !== "generating" || application.autogenClaimedAt == null) {
    return { status: "Error", detail: "This application is not being generated.", retryable: false, claimLost: true };
  }

  // The kit as it is now: a kit edited mid-run is checked again.
  const rendered = await renderGenerationPrompt(userId, application);
  if (!rendered.ok) return { status: "Error", detail: rendered.detail, retryable: false };

  let built: Record<string, unknown>;
  try {
    built = extractBuiltResumeJson(answer);
  } catch (error) {
    const detail = error instanceof AnswerParseError ? error.message : "Could not read the answer.";
    return { status: "Error", detail, retryable: true };
  }

  const result = finalizeBuiltResume({
    built,
    kit: rendered.kit,
    target: {
      jobTitle: application.jobTitle,
      company: application.company,
      jobDescription: application.jobDescription ?? "",
    },
    todayText: coverLetterDate(input.timeZone || DEFAULT_TIMEZONE),
  });
  if (!result.ok || !result.resume) {
    const shown = result.errors.slice(0, 6).join(" ");
    const more = result.errors.length > 6 ? ` (+${result.errors.length - 6} more)` : "";
    return { status: "Error", detail: `The resume JSON failed its checks: ${shown}${more}`, retryable: true };
  }

  const saved = await completeClaim(userId, application.id, claimedAt, JSON.stringify(result.resume, null, 2), {
    engine,
    completedAt: new Date().toISOString(),
    answerChars: answer.length,
    warnings: result.warnings,
    restored: result.restored,
    ...input.meta,
  });
  if (!saved) {
    return {
      status: "Error",
      detail: "Another worker took over this application; the answer was not saved.",
      retryable: false,
      claimLost: true,
    };
  }
  return { status: "Success", id: saved.id, warnings: result.warnings, restored: result.restored };
}
