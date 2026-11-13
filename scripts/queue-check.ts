import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  const { data } = await sb
    .from("resume_db_applications")
    .select("id, ats_platform, bid_state, posted_at")
    .eq("generation_status", "completed")
    .eq("apply", "Queued")
    .eq("bid_state", "none")
    .order("id", { ascending: true })
    .limit(60);

  console.log("=== CLAIM QUEUE ORDER (what auto-bid picks next) ===\n");
  let pos = 0;
  const byAts: Record<string, number> = {};
  for (const r of data || []) {
    pos++;
    const ats = r.ats_platform || "?";
    byAts[ats] = (byAts[ats] || 0) + 1;
    console.log(`  #${String(pos).padStart(2)} [id=${r.id}] ${ats.padEnd(18)} posted=${(r.posted_at || "?").substring(0, 10)}`);
  }
  console.log(`\nTotal claimable: ${data?.length || 0}`);
  console.log("\nBy ATS:");
  for (const [ats, n] of Object.entries(byAts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${ats.padEnd(18)} ${n}`);
  }

  // Ashby bid history
  const { data: ashbyAll } = await sb
    .from("resume_db_applications")
    .select("id, bid_state")
    .eq("ats_platform", "Ashby")
    .neq("bid_state", "none")
    .order("id", { ascending: false })
    .limit(50);

  console.log("\n=== ASHBY BID HISTORY (last 50) ===");
  const ashbyStates: Record<string, number> = {};
  for (const r of ashbyAll || []) {
    ashbyStates[r.bid_state] = (ashbyStates[r.bid_state] || 0) + 1;
  }
  for (const [s, n] of Object.entries(ashbyStates)) {
    console.log(`  ${s.padEnd(14)} ${n}`);
  }
  const ashbySubmitted = ashbyStates["submitted"] || 0;
  const ashbyTotal = Object.values(ashbyStates).reduce((s, n) => s + n, 0);
  console.log(`\n  Success rate: ${ashbySubmitted}/${ashbyTotal} = ${ashbyTotal ? Math.round(ashbySubmitted / ashbyTotal * 100) : 0}%`);
}
main().catch(console.error);
