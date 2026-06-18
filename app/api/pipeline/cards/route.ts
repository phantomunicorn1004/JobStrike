import { NextRequest } from "next/server";
import { corsJson, corsOptions } from "@/lib/api/extensionCors";
import { requireRequestUser } from "@/lib/auth/resolve-request-user";
import {
  updatePipelineCardDetails,
  type PipelineCardSource,
} from "@/lib/jobs/pipeline-access";

export function OPTIONS() {
  return corsOptions();
}

export async function PATCH(request: NextRequest) {
  try {
    const user = await requireRequestUser(request);
    const body = await request.json();
    const source = body.source as PipelineCardSource;
    const id = Number(body.id);
    const currentStageId = String(body.currentStageId ?? "applied");
    const update = body.update;

    if (source !== "jobs" && source !== "technical_jobs") {
      return corsJson({ error: "Invalid source." }, { status: 400 });
    }
    if (Number.isNaN(id) || id < 1) {
      return corsJson({ error: "Invalid id." }, { status: 400 });
    }
    if (!update || typeof update !== "object") {
      return corsJson({ error: "Missing update payload." }, { status: 400 });
    }

    const card = await updatePipelineCardDetails(user.id, source, id, currentStageId, {
      stage_dates: update.stage_dates ?? {},
      recruiter_name: String(update.recruiter_name ?? ""),
      recruiter_contact: String(update.recruiter_contact ?? ""),
      notes: String(update.notes ?? ""),
    });

    return corsJson({ ok: true, card });
  } catch (error) {
    console.error("Pipeline card PATCH error:", error);
    const message =
      error instanceof Error ? error.message : "Failed to save application.";
    const status = message === "Unauthorized" ? 401 : 500;
    return corsJson({ error: message }, { status });
  }
}
