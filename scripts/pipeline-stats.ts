import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
async function main() {
  const { data: all } = await sb.from("resume_db_applications").select("id, generation_status, apply, bid_state, generation_error").order("created_at", { ascending: false }).limit(500);
  if (!all) return;
  const genCounts: Record<string, number> = {};
  const applyCounts: Record<string, number> = {};
  const bidCounts: Record<string, number> = {};
  for (const a of all) {
    genCounts[a.generation_status || "null"] = (genCounts[a.generation_status || "null"] || 0) + 1;
    applyCounts[a.apply || "null"] = (applyCounts[a.apply || "null"] || 0) + 1;
    bidCounts[a.bid_state || "null"] = (bidCounts[a.bid_state || "null"] || 0) + 1;
  }
  console.log("=== GENERATION STATUS (last 500) ===");
  for (const [k, v] of Object.entries(genCounts).sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${v}`);
  console.log("\n=== APPLY STATUS ===");
  for (const [k, v] of Object.entries(applyCounts).sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${v}`);
  console.log("\n=== BID STATE ===");
  for (const [k, v] of Object.entries(bidCounts).sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${v}`);

  const failed = all.filter((a: any) => a.generation_status === "gen_failed");
  if (failed.length) {
    console.log(`\n=== GEN_FAILED ERRORS (${failed.length}) ===`);
    const errCounts: Record<string, number> = {};
    for (const a of failed) {
      const err = ((a as any).generation_error || "unknown").slice(0, 120);
      errCounts[err] = (errCounts[err] || 0) + 1;
    }
    for (const [k, v] of Object.entries(errCounts).sort((a, b) => b[1] - a[1])) console.log(`  [${v}x] ${k}`);
  }

  const applying = all.filter((a: any) => a.generation_status === "completed" && (a.apply === "Queued" || a.apply === "Applying"));
  console.log(`\nREADY TO APPLY (completed gen, Queued/Applying): ${applying.length}`);

  const queued = all.filter((a: any) => a.generation_status === "queue");
  console.log(`IN GENERATION QUEUE: ${queued.length}`);
}
main();
