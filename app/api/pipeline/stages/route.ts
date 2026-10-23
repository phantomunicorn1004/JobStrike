import { NextRequest } from "next/server";
import { corsJson, corsOptions } from "@/lib/api/extensionCors";
import { requireRequestUser, unauthorizedJson } from "@/lib/auth/resolve-request-user";
import {
  createPipelineStage,
  deletePipelineStage,
  listPipelineStages,
  reorderPipelineStages,
  updatePipelineStage,
} from "@/lib/jobs/pipeline-stages-repository";

/**
 * Board columns. The browser used to edit pipeline_stages directly with the public key; that is
 * now denied by row-level security, so the board goes through this route.
 */
export function OPTIONS() {
  return corsOptions();
}

function errorResponse(error: unknown, fallback: string) {
  if (error instanceof Error && error.message === "Unauthorized") {
    return corsJson(unauthorizedJson(), { status: 401 });
  }
  console.error("Pipeline stages error:", error);
  const message = error instanceof Error ? error.message : fallback;
  return corsJson({ error: message }, { status: 400 });
}

export async function GET(request: NextRequest) {
  try {
    await requireRequestUser(request);
    return corsJson({ stages: await listPipelineStages() });
  } catch (error) {
    return errorResponse(error, "Failed to load stages.");
  }
}

/** Body: { name } */
export async function POST(request: NextRequest) {
  try {
    await requireRequestUser(request);
    const body = await request.json();
    const stage = await createPipelineStage(String(body.name ?? ""));
    return corsJson({ stage });
  } catch (error) {
    return errorResponse(error, "Failed to add the stage.");
  }
}

/** Body: { id, name?, isVisible? } or { order: string[] } */
export async function PATCH(request: NextRequest) {
  try {
    await requireRequestUser(request);
    const body = await request.json();
    if (Array.isArray(body.order)) {
      await reorderPipelineStages(body.order.map((id: unknown) => String(id)));
    } else {
      const id = String(body.id ?? "");
      if (!id) throw new Error("Stage id is required.");
      await updatePipelineStage(id, {
        name: typeof body.name === "string" ? body.name : undefined,
        isVisible: typeof body.isVisible === "boolean" ? body.isVisible : undefined,
      });
    }
    return corsJson({ ok: true });
  } catch (error) {
    return errorResponse(error, "Failed to update the stage.");
  }
}

/** Query: ?id= */
export async function DELETE(request: NextRequest) {
  try {
    await requireRequestUser(request);
    const id = request.nextUrl.searchParams.get("id") ?? "";
    if (!id) throw new Error("Stage id is required.");
    await deletePipelineStage(id);
    return corsJson({ ok: true });
  } catch (error) {
    return errorResponse(error, "Failed to remove the stage.");
  }
}
