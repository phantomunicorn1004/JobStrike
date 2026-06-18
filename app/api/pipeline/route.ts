import { NextRequest } from "next/server";
import { corsJson, corsOptions } from "@/lib/api/extensionCors";
import {
  requireRequestUser,
  resolveRequestUser,
  unauthorizedJson,
} from "@/lib/auth/resolve-request-user";
import { listUserPipelineBoard } from "@/lib/jobs/pipeline-access";

export function OPTIONS() {
  return corsOptions();
}

export async function GET(request: NextRequest) {
  try {
    const user = await resolveRequestUser(request);
    if (!user) {
      return corsJson(unauthorizedJson(), { status: 401 });
    }

    const board = await listUserPipelineBoard(user.id);
    return corsJson(board);
  } catch (error) {
    console.error("Pipeline GET error:", error);
    const message =
      error instanceof Error ? error.message : "Failed to load pipeline.";
    return corsJson({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireRequestUser(request);
    const body = await request.json();
    const action = String(body.action ?? "");

    if (action === "reassignStage") {
      const { reassignUserTechnicalJobsStage } = await import(
        "@/lib/jobs/pipeline-access"
      );
      const fromStageId = String(body.fromStageId ?? "").trim();
      const toStageId = String(body.toStageId ?? "").trim();
      if (!fromStageId || !toStageId) {
        return corsJson({ error: "fromStageId and toStageId are required." }, { status: 400 });
      }
      await reassignUserTechnicalJobsStage(user.id, fromStageId, toStageId);
      return corsJson({ ok: true });
    }

    return corsJson({ error: "Unknown action." }, { status: 400 });
  } catch (error) {
    console.error("Pipeline POST error:", error);
    const message =
      error instanceof Error ? error.message : "Pipeline action failed.";
    const status = message === "Unauthorized" ? 401 : 500;
    return corsJson({ error: message }, { status });
  }
}
