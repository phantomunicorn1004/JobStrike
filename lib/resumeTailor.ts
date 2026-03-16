import OpenAI from "openai";
import { HttpsProxyAgent } from "https-proxy-agent";

export type ATSKeywords = {
  technical_skills: string[];
  tools_and_technologies: string[];
  job_responsibilities: string[];
  industry_terms: string[];
};

export type TailoredExperience = {
  job_title: string;
  company: string;
  bullets: string[];
};

export type TailorResumeResponse = {
  ats_keywords: ATSKeywords;
  profile_title: string;
  professional_summary: string;
  skills_optimized?: string[];
  tailored_experience: TailoredExperience[];
};

export type TailorResumeInput = {
  jobTitle: string;
  jobDescription: string;
  resumeText: string;
};

const SYSTEM_PROMPT = `You are a scoped resume improvement engine focused on ATS optimization.

Your role is to improve ONLY specific sections of a resume while preserving everything else exactly as-is.

SCOPED EDITING RULES:

✅ YOU MAY EDIT:
1. Profile/headline title - Optimize for job title alignment and ATS keywords
2. Professional summary - Improve clarity, impact, and keyword density (2-3 sentences)
3. Technical skills section - Reorder, normalize naming, remove redundancy, improve ATS alignment
4. Work experience accomplishments - Improve bullet points only:
   - Enhance clarity and impact
   - Use stronger action verbs
   - Preserve all metrics and numbers exactly as stated
   - Maintain original meaning

❌ YOU MUST NOT EDIT:
- Company names (preserve exactly)
- Employment dates (preserve exactly)
- Locations (preserve exactly)
- Role/job titles (preserve exactly, no changes)
- Education section (preserve exactly)
- Certifications section (preserve exactly)
- Section order (preserve exactly)
- Formatting, fonts, spacing (preserve exactly)
- Skills that are not already present (no invention)

CRITICAL CONSTRAINTS:
- Use ONLY information already present in the resume
- Never invent experience, skills, companies, tools, or metrics
- Never add new skills that weren't in the original
- Preserve all numbers, dates, and metrics exactly
- Use ATS-safe plain text only
- No first-person language
- No emojis, icons, tables, markdown, or formatting symbols

You MUST return VALID JSON ONLY.
No extra text.
`;

function createUserPrompt(input: TailorResumeInput): string {
  return `Job Title: ${input.jobTitle}

Job Description:
${input.jobDescription}

Original Resume Text:
${input.resumeText}

====================
TASKS
====================

1. Extract ATS keywords from the Job Description and categorize them into:
   - technical_skills
   - tools_and_technologies
   - job_responsibilities
   - industry_terms

2. Generate scoped improvements for allowed sections:
   - Profile title: Optimize for job title alignment (6–12 words, preserve original if unclear)
   - Professional summary: Improve clarity and keyword density (2–3 concise sentences)
   - Technical skills: If a skills section exists in the original resume:
       * Reorder skills for logical grouping
       * Normalize naming (e.g., "REST APIs" vs "RESTful APIs")
       * Remove redundancy
       * Improve ATS keyword alignment
       * Return as "skills_optimized" array
   - Experience bullets ONLY:
       - Improve clarity and impact
       - Use stronger action verbs
       - Preserve ALL metrics and numbers exactly as stated
       - Maintain original meaning and context
       - 3–5 bullets per role (match original count when possible)
       - Plain text, ATS-safe
   
   IMPORTANT: Only return experience entries that exist in the original resume.
   Match by job title. Do not create new roles or modify role titles/companies.

====================
OUTPUT FORMAT (JSON ONLY)
====================

{
  "ats_keywords": {
    "technical_skills": [],
    "tools_and_technologies": [],
    "job_responsibilities": [],
    "industry_terms": []
  },
  "profile_title": "",
  "professional_summary": "",
  "skills_optimized": [],
  "tailored_experience": [
    {
      "job_title": "",
      "company": "",
      "bullets": [
        "",
        "",
        "",
        ""
      ]
    }
  ]
}

IMPORTANT NOTES:
- "job_title" and "company" must match the original resume exactly (used for matching)
- Only include experience entries that exist in the original resume
- "skills_optimized" is optional - only include if skills section exists in original
- Do not add new skills - only reorder/normalize existing ones
`;
}

function validateResponse(data: any): data is TailorResumeResponse {
  if (!data || typeof data !== "object") return false;

  // Validate ats_keywords
  if (!data.ats_keywords || typeof data.ats_keywords !== "object") return false;
  const requiredKeywordFields = [
    "technical_skills",
    "tools_and_technologies",
    "job_responsibilities",
    "industry_terms",
  ];
  for (const field of requiredKeywordFields) {
    if (!Array.isArray(data.ats_keywords[field])) return false;
  }

  // Validate profile_title
  if (typeof data.profile_title !== "string" || !data.profile_title.trim())
    return false;

  // Validate professional_summary
  if (
    typeof data.professional_summary !== "string" ||
    !data.professional_summary.trim()
  )
    return false;

  // Validate tailored_experience
  if (!Array.isArray(data.tailored_experience)) return false;
  for (const exp of data.tailored_experience) {
    if (typeof exp.job_title !== "string" || !exp.job_title.trim()) return false;
    if (typeof exp.company !== "string" || !exp.company.trim()) return false;
    if (!Array.isArray(exp.bullets)) return false;
    for (const bullet of exp.bullets) {
      if (typeof bullet !== "string" || !bullet.trim()) return false;
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

export async function tailorResumeWithOpenAI(
  input: TailorResumeInput
): Promise<TailorResumeResponse> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY environment variable is not set");
  }

  // Support custom base URL for proxy/alternative endpoints
  const baseURL = process.env.OPENAI_BASE_URL || undefined;
  
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
      temperature: 0.3, // Lower temperature for more consistent, factual output
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
