import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(url, key);

async function main() {
  // Check when the 5 registered apps were created and generated
  const ids = [2757, 2752, 2737, 2728, 2725];
  const { data: apps } = await supabase
    .from("resume_db_applications")
    .select("id, company, created_at, generation_status, generation_meta, apply, bid_state")
    .in("id", ids)
    .order("created_at", { ascending: false });

  console.log("=== APP TIMELINE ===\n");
  for (const app of apps || []) {
    const gm = app.generation_meta as any;
    console.log(`#${app.id} ${app.company}`);
    console.log(`  created_at: ${app.created_at}`);
    console.log(`  gen_status: ${app.generation_status}`);
    console.log(`  apply: ${app.apply}`);
    console.log(`  bid_state: ${app.bid_state}`);
    if (gm?.generatedAt) console.log(`  generatedAt: ${gm.generatedAt}`);
    if (gm?.completedAt) console.log(`  completedAt: ${gm.completedAt}`);
    if (gm?.finalized_at) console.log(`  finalized_at: ${gm.finalized_at}`);
    if (gm?.model) console.log(`  model: ${gm.model}`);
    console.log(`  meta keys: ${Object.keys(gm || {}).join(", ")}`);
    console.log();
  }

  // Also check the Profile 4 kit update time
  console.log("=== KIT HISTORY ===\n");
  const { data: kit } = await supabase
    .from("profile_prompt_kits")
    .select("updated_at, profile_id")
    .eq("profile_id", 4)
    .single();
  if (kit) {
    console.log(`Profile 4 kit updated_at: ${kit.updated_at}`);
  }

  // Fix timeline reference
  console.log("\n=== CODE FIX TIMELINE ===");
  console.log("Commit 8b1155f (placeholder skip + empty reject): deployed ~Nov 11");
  console.log("Commit c4fcd7e (instruction text detection): deployed ~Nov 12");
  console.log("Kit updated to empty companies: ~Nov 11 ~2:45 PM");
}

main().catch(console.error);
