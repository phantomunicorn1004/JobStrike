import type { NextRequest } from "next/server";
import { corsJson, corsOptions } from "@/lib/api/extensionCors";
import { completeWithAnswer } from "@/lib/autogen/complete";
import { sameInstant } from "@/lib/autogen/dto";
import { autogenRoute, idParam, readJson, type IdContext } from "@/lib/autogen/route";
import { getApplicationById } from "@/lib/resume-db/repository";

export function OPTIONS() {
  return corsOptions();
}

/**
 * POST /api/autogen/applications/:id/submit-answer — body { answer, claimedAt }.
 * The ChatGPT tab's raw reply. The JSON is extracted, the kit's facts put
 * back, every placeholder checked, then saved. Always 200 with
 * { status: "Success" } or { status: "Error", detail, retryable, claimLost? };
 * on Error the row stays claimed so the worker can retry or report it.
 */
export async function POST(request: NextRequest, context: IdContext) {
  return autogenRoute(request, "submit-answer", async (user) => {
    const id = await idParam(context);
    const body = await readJson(request);
    const claimedAt = String(body.claimedAt ?? "").trim();
    const answer = String(body.answer ?? "");
    if (!id || !claimedAt) {
      return corsJson({ status: "Error", detail: "id and claimedAt are required.", retryable: false });
    }
    if (!answer.trim()) {
      return corsJson({ status: "Error", detail: "The answer is empty.", retryable: true });
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
    const attempt = Number(body.attempt);
    return corsJson(
      await completeWithAnswer({
        userId: user.id,
        timeZone: user.timezone,
        application,
        claimedAt,
        answer,
        engine: "chatgpt",
        meta: {
          ...(Number.isFinite(attempt) && { attempt }),
          ...(typeof body.chatgptModel === "string" && { model: body.chatgptModel.slice(0, 60) }),
        },
      }),
    );
  });
}
