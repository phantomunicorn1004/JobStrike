import "server-only";

import type { ReasoningEffort } from "openai/resources/shared";
import { serverOpenAI } from "@/lib/ai/server-openai";

/** OPENAI_RESUME_MODEL, else this. */
export const DEFAULT_RESUME_MODEL = "gpt-6.1-sol";

const EFFORTS: ReadonlyArray<NonNullable<ReasoningEffort>> = ["none", "minimal", "low", "medium", "high", "xhigh"];

export type OpenAIGeneration = {
  answer: string;
  model: string;
  tokens: { input: number; cachedInput: number; output: number; reasoning: number };
  ms: number;
};

export function resumeModel(): string {
  return process.env.OPENAI_RESUME_MODEL?.trim() || DEFAULT_RESUME_MODEL;
}

/** OPENAI_RESUME_REASONING_EFFORT; unset sends none, for models without reasoning. */
function reasoningEffort(): NonNullable<ReasoningEffort> | null {
  const value = process.env.OPENAI_RESUME_REASONING_EFFORT?.trim().toLowerCase() || "";
  return (EFFORTS as readonly string[]).includes(value) ? (value as NonNullable<ReasoningEffort>) : null;
}

/**
 * One generation through the API with the server's key. The prompt is the
 * same one the ChatGPT tab receives; json_object mode guarantees the reply is
 * a single JSON object (the kits ask for JSON, which that mode requires).
 */
export async function generateWithOpenAI(prompt: string, signal?: AbortSignal): Promise<OpenAIGeneration> {
  const client = serverOpenAI();
  if (!client) throw new Error("OPENAI_API_KEY is not set on the server.");
  const model = resumeModel();
  const effort = reasoningEffort();
  const started = Date.now();

  const response = await client.responses.create(
    {
      model,
      input: prompt,
      text: { format: { type: "json_object" } },
      ...(effort && { reasoning: { effort } }),
    },
    { signal, timeout: 280_000 },
  );

  if (response.status === "incomplete") {
    const why = response.incomplete_details?.reason || "unknown reason";
    throw new Error(`The API stopped before finishing the resume (${why}).`);
  }
  const usage = response.usage;
  return {
    answer: response.output_text ?? "",
    model: response.model || model,
    tokens: {
      input: usage?.input_tokens ?? 0,
      cachedInput: usage?.input_tokens_details?.cached_tokens ?? 0,
      output: usage?.output_tokens ?? 0,
      reasoning: usage?.output_tokens_details?.reasoning_tokens ?? 0,
    },
    ms: Date.now() - started,
  };
}
