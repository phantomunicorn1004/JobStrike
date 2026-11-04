import "server-only";

import { serverOpenAI } from "@/lib/ai/server-openai";
import { FIT_RESPONSE_FORMAT, type FitModel, type FitModelReply } from "@/lib/autobid/fit";

/** AUTOBID_AI_MODEL, else the small model the other server checks use. */
const MODEL = process.env.AUTOBID_AI_MODEL?.trim() || "gpt-4o-mini";

/** The fit check's model call with the server's key (OPENAI_API_KEY on Vercel). */
export const openAiFitModel: FitModel = async ({ system, user }) => {
  const openai = serverOpenAI();
  if (!openai) throw new Error("OPENAI_API_KEY is not set on the server.");
  const completion = await openai.chat.completions.create(
    {
      model: MODEL,
      temperature: 0,
      response_format: FIT_RESPONSE_FORMAT,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    },
    { timeout: 45_000 },
  );
  return JSON.parse(completion.choices[0]?.message?.content ?? "{}") as FitModelReply;
};
