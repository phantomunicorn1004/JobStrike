import { NextRequest } from "next/server";
import { corsJson, corsOptions } from "@/lib/api/extensionCors";
import {
  requireRequestUser,
  resolveRequestUser,
  unauthorizedJson,
} from "@/lib/auth/resolve-request-user";
import { DEFAULT_PROMPT_TEMPLATE } from "@/lib/promptBuilder";
import {
  emptyProfilePromptKit,
  type ProfilePromptKit,
} from "@/lib/resume-builder/promptKitStorage";
import {
  getProfilePromptKit,
  upsertProfilePromptKit,
} from "@/lib/resume-db/prompt-kit-repository";

export function OPTIONS() {
  return corsOptions();
}

function parseProfileId(idParam: string): number | null {
  const profileId = Number(idParam);
  if (Number.isNaN(profileId) || profileId < 1) return null;
  return profileId;
}

function parseKitBody(body: Record<string, unknown>): ProfilePromptKit {
  const templateRaw = body.template ?? body.prompt_template ?? body.promptTemplate;
  const resumeRaw =
    body.resumeTemplateJson ??
    body.resume_template_json ??
    body.resumeTemplateJSON;
  const jobRaw = body.jobDescription ?? body.job_description;
  const outputRaw = body.output ?? body.last_output ?? body.lastOutput;

  return emptyProfilePromptKit({
    template:
      typeof templateRaw === "string" && templateRaw.length > 0
        ? templateRaw
        : DEFAULT_PROMPT_TEMPLATE,
    resumeTemplateJson: typeof resumeRaw === "string" ? resumeRaw : "",
    jobDescription: typeof jobRaw === "string" ? jobRaw : "",
    output: typeof outputRaw === "string" ? outputRaw : "",
  });
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await resolveRequestUser(request);
    if (!user) {
      return corsJson(unauthorizedJson(), { status: 401 });
    }

    const { id: idParam } = await context.params;
    const profileId = parseProfileId(idParam);
    if (profileId == null) {
      return corsJson({ error: "Invalid profile id" }, { status: 400 });
    }

    const result = await getProfilePromptKit(user.id, profileId);
    return corsJson({
      kit: result.kit,
      exists: result.exists,
      profileId,
    });
  } catch (error) {
    console.error("Prompt kit GET error:", error);
    const message =
      error instanceof Error ? error.message : "Failed to load prompt kit.";
    const status =
      message === "Unauthorized"
        ? 401
        : message === "Profile not found"
          ? 404
          : 500;
    return corsJson({ error: message }, { status });
  }
}

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireRequestUser(request);
    const { id: idParam } = await context.params;
    const profileId = parseProfileId(idParam);
    if (profileId == null) {
      return corsJson({ error: "Invalid profile id" }, { status: 400 });
    }

    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const kitInput = parseKitBody(
      body.kit && typeof body.kit === "object"
        ? (body.kit as Record<string, unknown>)
        : body,
    );

    const kit = await upsertProfilePromptKit(user.id, profileId, kitInput);
    return corsJson({
      kit,
      exists: true,
      profileId,
    });
  } catch (error) {
    console.error("Prompt kit PUT error:", error);
    const message =
      error instanceof Error ? error.message : "Failed to save prompt kit.";
    const status =
      message === "Unauthorized"
        ? 401
        : message === "Profile not found"
          ? 404
          : 500;
    return corsJson({ error: message }, { status });
  }
}
