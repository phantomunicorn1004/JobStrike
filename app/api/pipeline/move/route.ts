import { NextRequest } from "next/server";
import { corsJson, corsOptions } from "@/lib/api/extensionCors";
import { requireRequestUser } from "@/lib/auth/resolve-request-user";
import {
  movePipelineCard,
  type PipelineCardSource,
} from "@/lib/jobs/pipeline-access";

export function OPTIONS() {
  return corsOptions();
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireRequestUser(request);
    const body = await request.json();
    const source = body.source as PipelineCardSource;
    const id = Number(body.id);
    const stageId = String(body.stageId ?? "");
    const targetStageId = String(body.targetStageId ?? "");

    if (source !== "jobs" && source !== "technical_jobs") {
      return corsJson({ error: "Invalid source." }, { status: 400 });
    }
    if (Number.isNaN(id) || id < 1) {
      return corsJson({ error: "Invalid id." }, { status: 400 });
    }
    if (!stageId || !targetStageId) {
      return corsJson({ error: "stageId and targetStageId are required." }, { status: 400 });
    }

    const result = await movePipelineCard(
      user.id,
      { source, id, stageId },
      targetStageId,
    );

    return corsJson({ ok: true, ...result });
  } catch (error) {
    console.error("Pipeline move error:", error);
    const message =
      error instanceof Error ? error.message : "Failed to move application.";
    const status = message === "Unauthorized" ? 401 : 500;
    return corsJson({ error: message }, { status });
  }
}
