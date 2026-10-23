import "server-only";

import { getSupabaseAdminClient } from "@/lib/supabase/admin";

/** A board column. The table is shared by all users (it has no user_id yet). */
export type PipelineStageRow = {
  id: string;
  name: string;
  sort_order: number;
  is_visible: boolean;
};

export const DEFAULT_PIPELINE_STAGES: PipelineStageRow[] = [
  { id: "applied", name: "Applied", sort_order: 0, is_visible: true },
  { id: "technical", name: "Technical", sort_order: 1, is_visible: true },
  { id: "final", name: "Final", sort_order: 2, is_visible: true },
];

function stageSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

/** All stages in board order; the defaults are created on first use. */
export async function listPipelineStages(): Promise<PipelineStageRow[]> {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("pipeline_stages")
    .select("id, name, sort_order, is_visible")
    .order("sort_order", { ascending: true });
  if (error) throw error;
  if (!data || data.length === 0) {
    const { error: insertError } = await supabase
      .from("pipeline_stages")
      .insert(DEFAULT_PIPELINE_STAGES as never);
    if (insertError) throw insertError;
    return DEFAULT_PIPELINE_STAGES;
  }
  return (data as PipelineStageRow[]).map((stage) => ({
    ...stage,
    is_visible: stage.is_visible !== false,
  }));
}

export async function createPipelineStage(name: string): Promise<PipelineStageRow> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Stage name is required.");
  const supabase = getSupabaseAdminClient();
  const stages = await listPipelineStages();
  const sortOrder = stages.length ? Math.max(...stages.map((s) => s.sort_order)) + 1 : 0;
  let id = stageSlug(trimmed) || `stage-${Date.now()}`;
  if (stages.some((s) => s.id === id)) {
    id = `${id}-${Date.now()}`;
  }
  const row: PipelineStageRow = { id, name: trimmed, sort_order: sortOrder, is_visible: true };
  const { error } = await supabase.from("pipeline_stages").insert(row as never);
  if (error) throw error;
  return row;
}

export async function updatePipelineStage(
  id: string,
  patch: { name?: string; isVisible?: boolean },
): Promise<void> {
  const update: Record<string, unknown> = {};
  if (patch.name !== undefined) {
    const trimmed = patch.name.trim();
    if (!trimmed) throw new Error("Stage name is required.");
    update.name = trimmed;
  }
  if (patch.isVisible !== undefined) {
    if (!patch.isVisible) {
      const visible = (await listPipelineStages()).filter((s) => s.is_visible && s.id !== id);
      if (visible.length === 0) throw new Error("At least one stage must remain visible.");
    }
    update.is_visible = patch.isVisible;
  }
  if (Object.keys(update).length === 0) return;
  const { error } = await getSupabaseAdminClient()
    .from("pipeline_stages")
    .update(update as never)
    .eq("id", id);
  if (error) throw error;
}

/** Saves the board order: <paramref name="orderedIds"/> lists every stage id, first to last. */
export async function reorderPipelineStages(orderedIds: string[]): Promise<void> {
  const supabase = getSupabaseAdminClient();
  const results = await Promise.all(
    orderedIds.map((id, index) =>
      supabase.from("pipeline_stages").update({ sort_order: index } as never).eq("id", id),
    ),
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) throw failed.error;
}

/** Deletes a stage. Cards in it must have been moved first (POST /api/pipeline reassignStage). */
export async function deletePipelineStage(id: string): Promise<void> {
  if (id === "applied") throw new Error("The Applied stage cannot be removed.");
  const { error } = await getSupabaseAdminClient().from("pipeline_stages").delete().eq("id", id);
  if (error) throw error;
}
