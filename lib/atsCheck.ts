import OpenAI from "openai";
import { HttpsProxyAgent } from "https-proxy-agent";

export type ATSCheckResponse = {
  ats_score: number;
  matched_keywords: string[];
  missing_keywords: string[];
  weak_keywords: string[];
  recommendations: string[];
};

export type ATSCheckInput = {
  jobTitle: string;
  jobDescription: string;
  tailoredResumeText: string;
};

const SYSTEM_PROMPT = `You are an ATS (Applicant Tracking System) analyzer. Your role is to evaluate how well a resume matches a job description from an ATS perspective.

CRITICAL RULES:
1. DO NOT rewrite or modify the resume content
2. DO NOT suggest invented skills or experience
3. Focus ONLY on keyword matching and ATS compatibility
4. Provide actionable, keyword-level feedback only
5. Return valid JSON only - no explanations or commentary

Your analysis should be objective, factual, and focused on ATS keyword matching.`;

function createUserPrompt(input: ATSCheckInput): string {
  return `Job Title: ${input.jobTitle}

Job Description:
${input.jobDescription}

Tailored Resume:
${input.tailoredResumeText}

====================
TASK
====================

Analyze the keyword overlap between the Job Description and the Tailored Resume from an ATS perspective.

1. Calculate ATS Score (0-100):
   - 90-100: Excellent match, most keywords present
   - 70-89: Good match, some gaps
   - 50-69: Moderate match, significant gaps
   - 0-49: Poor match, many missing keywords

2. Identify Keywords:
   - matched_keywords: Technical skills, tools, and terms that appear in both JD and resume
   - missing_keywords: Important keywords from JD that are absent in resume
   - weak_keywords: Keywords that appear but are mentioned infrequently or weakly

3. Provide Recommendations:
   - Short, keyword-focused suggestions (one per line)
   - Focus on adding missing technical terms
   - Do NOT suggest rewriting entire sections
   - Do NOT suggest invented skills

====================
OUTPUT FORMAT (JSON ONLY)
====================

{
  "ats_score": 0,
  "matched_keywords": [],
  "missing_keywords": [],
  "weak_keywords": [],
  "recommendations": []
}`;
}

function validateResponse(data: any): data is ATSCheckResponse {
  if (!data || typeof data !== "object") return false;

  // Validate ats_score
  if (
    typeof data.ats_score !== "number" ||
    data.ats_score < 0 ||
    data.ats_score > 100
  ) {
    return false;
  }

  // Validate keyword arrays
  const requiredArrays = [
    "matched_keywords",
    "missing_keywords",
    "weak_keywords",
    "recommendations",
  ];
  for (const field of requiredArrays) {
    if (!Array.isArray(data[field])) return false;
    // Ensure all items are strings
    for (const item of data[field]) {
      if (typeof item !== "string") return false;
    }
  }

  return true;
}

/**
 * Parse proxy configuration from environment variable
 * Format: host:port:username:password
 */
function getProxyAgent() {
  const proxyConfig = process.env.OPENAI_PROXY;
  if (!proxyConfig) {
    return undefined;
  }

  try {
    // Remove quotes and trim whitespace
    const cleanedConfig = proxyConfig.replace(/^["']|["']$/g, "").trim();
    
    // Parse proxy format: host:port:username:password
    const parts = cleanedConfig.split(":");
    if (parts.length >= 4) {
      const [host, port, username, ...passwordParts] = parts;
      // Join password parts in case password contains colons
      const password = passwordParts.join(":");
      const proxyUrl = `http://${username}:${password}@${host}:${port}`;
      return new HttpsProxyAgent(proxyUrl);
    }
  } catch (error) {
    console.error("Failed to parse proxy configuration:", error);
  }

  return undefined;
}

export async function checkATSWithOpenAI(
  input: ATSCheckInput
): Promise<ATSCheckResponse> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY environment variable is not set");
  }

  // Support custom base URL for proxy/alternative endpoints
  const baseURL = process.env.OPENAI_PROXY || undefined;
  
  // Configure proxy agent if proxy is set
  const httpAgent = getProxyAgent();

  const openai = new OpenAI({
    apiKey: apiKey,
    ...(baseURL && { baseURL }),
    ...(httpAgent && { httpAgent }),
  });

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: createUserPrompt(input) },
      ],
      response_format: { type: "json_object" },
      temperature: 0.2, // Very low temperature for consistent, objective analysis
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) {
      throw new Error("OpenAI returned empty response");
    }

    let parsedData;
    try {
      parsedData = JSON.parse(content);
    } catch (parseError) {
      throw new Error(`Failed to parse OpenAI response as JSON: ${parseError}`);
    }

    if (!validateResponse(parsedData)) {
      throw new Error("OpenAI response validation failed");
    }

    return parsedData;
  } catch (error: any) {
    // Handle specific OpenAI API errors
    if (error?.status === 403 || error?.message?.includes("403")) {
      if (error?.message?.includes("Country") || error?.message?.includes("region") || error?.message?.includes("territory")) {
        throw new Error(
          "OpenAI API is not available in your region. Please use a VPN or contact your administrator to configure an alternative endpoint."
        );
      }
      throw new Error("OpenAI API access forbidden. Please check your API key and account status.");
    }
    
    if (error?.status === 401) {
      throw new Error("Invalid OpenAI API key. Please check your environment variables.");
    }
    
    if (error?.status === 429) {
      throw new Error("OpenAI API rate limit exceeded. Please try again later.");
    }
    
    if (error instanceof Error) {
      // Check if it's already a formatted error message
      if (error.message.startsWith("OpenAI API error:")) {
        throw error;
      }
      throw new Error(`OpenAI API error: ${error.message}`);
    }
    throw error;
  }
}
