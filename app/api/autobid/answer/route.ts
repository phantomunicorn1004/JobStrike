import type { NextRequest } from "next/server";
import { corsJson, corsOptions } from "@/lib/api/extensionCors";
import { answerAndRetry } from "@/lib/autobid/answer";
import { autogenRoute, readJson } from "@/lib/autogen/route";

export function OPTIONS() {
  return corsOptions();
}

/**
 * POST /api/autobid/answer — body { id, answers: [{ question, answer }] }.
 * Saves the answers on the job's candidate profile and retries the job.
 */
export async function POST(request: NextRequest) {
  return autogenRoute(request, "auto-bid answer", async (user) => {
    const body = await readJson(request);
    const id = Number(body.id);
    if (!Number.isInteger(id) || id < 1) return corsJson({ error: "id is required." }, { status: 400 });
    const answers = (Array.isArray(body.answers) ? body.answers : [])
      .map((entry: unknown) => {
        const e = (entry ?? {}) as Record<string, unknown>;
        return { question: String(e.question ?? "").trim(), answer: String(e.answer ?? "").trim() };
      })
      .filter((entry: { question: string; answer: string }) => entry.question && entry.answer)
      .slice(0, 20);
    if (!answers.length) return corsJson({ error: "Type at least one answer." }, { status: 400 });
    return corsJson(await answerAndRetry(user.id, id, answers));
  });
}
