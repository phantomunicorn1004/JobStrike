import type { NextRequest } from "next/server";
import { corsJson, corsOptions } from "@/lib/api/extensionCors";
import { completeWithAnswer } from "@/lib/autogen/complete";
import { sameInstant } from "@/lib/autogen/dto";
import { generateWithOpenAI } from "@/lib/autogen/engine-openai";
import { renderGenerationPrompt } from "@/lib/autogen/prompt";
import { autogenRoute, idParam, readJson, type IdContext } from "@/lib/autogen/route";
import { getApplicationById } from "@/lib/resume-db/repository";

/** One API generation can take a few minutes. */
export const maxDuration = 300;

export function OPTIONS() {
  return corsOptions();
}

/**
 * POST /api/autogen/applications/:id/generate — body { claimedAt, attempt? }.
 * The API engine: the same prompt the ChatGPT tab would get, sent with the
 * server's OPENAI_API_KEY, then the same checks as submit-answer. Same
 * response shape: { status: "Success" | "Error", … }.
 */
export async function POST(request: NextRequest, context: IdContext) {
  return autogenRoute(request, "generate", async (user) => {
    const id = await idParam(context);
    const body = await readJson(request);
    const claimedAt = String(body.claimedAt ?? "").trim();
    if (!id || !claimedAt) {
      return corsJson({ status: "Error", detail: "id and claimedAt are required.", retryable: false });
    }
    const application = await getApplicationById(id, user.id);
    if (!application || !sameInstant(application.autogenClaimedAt, claimedAt)) {
      return corsJson({
        status: "Error",
        detail: "This worker no longer holds the claim on the application.",
        retryable: false,
        claimLost: true,
      });
    }
    const rendered = await renderGenerationPrompt(user.id, application);
    if (!rendered.ok) return corsJson({ status: "Error", detail: rendered.detail, retryable: false });

    let generation;
    try {
      generation = await generateWithOpenAI(rendered.prompt, request.signal);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "The API call failed.";
      const retryable = !/OPENAI_API_KEY|401|invalid api key|insufficient_quota|429/i.test(detail);
      return corsJson({ status: "Error", detail: `OpenAI: ${detail}`, retryable });
    }

    const attempt = Number(body.attempt);
    return corsJson(
      await completeWithAnswer({
        userId: user.id,
        timeZone: user.timezone,
        application,
        claimedAt,
        answer: generation.answer,
        engine: "api",
        meta: {
          model: generation.model,
          tokens: generation.tokens,
          ms: generation.ms,
          ...(Number.isFinite(attempt) && { attempt }),
        },
      }),
    );
  });
}
