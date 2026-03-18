import OpenAI from "openai";
import { HttpsProxyAgent } from "https-proxy-agent";
import type { NormalizedJobDescription } from "@/components/resume-tailor/workflow/contracts";

export type JdParseInput = {
  jobDescription: string;
  openaiApiKey?: string;
  model?: string;
};

const SYSTEM_PROMPT = `You are a job description parser. Extract structured data from raw job description text.

RULES:
1. Return ONLY valid JSON. No markdown, no explanation.
2. Extract concrete skills and terms; avoid vague phrases.
3. requiredSkills: must-have qualifications (technologies, years, certifications).
4. preferredSkills: nice-to-have qualifications.
5. toolsAndTechnologies: specific tools, languages, frameworks mentioned.
6. responsibilities: key job duties or responsibility phrases (short).
7. senioritySignals: terms indicating level (e.g. "Senior", "Lead", "5+ years").
8. industryTerms: domain-specific or industry keywords.
9. Keep each array item concise (a few words). Use empty arrays if nothing fits.
10. rawText: pass through the original job description text unchanged.`;

function getProxyAgent() {
  const proxyConfig = process.env.OPENAI_PROXY;
  if (!proxyConfig) return undefined;
  try {
    const cleaned = proxyConfig.replace(/^["']|["']$/g, "").trim();
    const parts = cleaned.split(":");
    if (parts.length >= 4) {
      const [host, port, username, ...passwordParts] = parts;
      const password = passwordParts.join(":");
      const proxyUrl = `http://${username}:${password}@${host}:${port}`;
      return new HttpsProxyAgent(proxyUrl);
    }
  } catch (e) {
    console.error("Failed to parse proxy config", e);
  }
  return undefined;
}

function validateResponse(data: unknown): data is NormalizedJobDescription {
  if (!data || typeof data !== "object") return false;
  const o = data as Record<string, unknown>;
  const arr = (k: string) => Array.isArray(o[k]) && (o[k] as unknown[]).every((x) => typeof x === "string");
  return (
    arr("requiredSkills") &&
    arr("preferredSkills") &&
    arr("toolsAndTechnologies") &&
    arr("responsibilities") &&
    arr("senioritySignals") &&
    arr("industryTerms") &&
    typeof o.rawText === "string"
  );
}

export async function parseJobDescriptionWithOpenAI(
  input: JdParseInput
): Promise<NormalizedJobDescription> {
  const apiKey = (input.openaiApiKey?.trim() || process.env.OPENAI_API_KEY) ?? null;
  if (!apiKey) {
    throw new Error(
      "OpenAI API key is required. Set OPENAI_API_KEY in the environment or provide a key in the JD Parsing node settings."
    );
  }

  const baseURL = process.env.OPENAI_BASE_URL || undefined;
  const httpAgent = input.openaiApiKey ? undefined : getProxyAgent();

  const openai = new OpenAI({
    apiKey,
    ...(baseURL && { baseURL }),
    ...(httpAgent && { httpAgent }),
  });

  const model = input.model?.trim() || "gpt-4o-mini";

  const completion = await openai.chat.completions.create({
    model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `Parse this job description and return a single JSON object with keys: requiredSkills, preferredSkills, toolsAndTechnologies, responsibilities, senioritySignals, industryTerms, rawText.\n\nJob description:\n${input.jobDescription}`,
      },
    ],
    response_format: { type: "json_object" },
    temperature: 0.2,
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) throw new Error("OpenAI returned empty response");

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("OpenAI response was not valid JSON");
  }

  if (!validateResponse(parsed)) throw new Error("OpenAI response missing required JD fields");

  return {
    ...parsed,
    rawText: (parsed as NormalizedJobDescription).rawText || input.jobDescription,
  };
}
