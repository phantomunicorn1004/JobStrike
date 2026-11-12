import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(url, key);

async function main() {
  const { data: apps, error } = await supabase
    .from("resume_db_applications")
    .select("id, company, apply, applied_at, created_at, generation_meta, bid_state, bid_claimed_at, bid_meta")
    .in("id", [2757, 2752, 2737, 2728, 2725])
    .order("created_at", { ascending: false });

  if (error) { console.error("QUERY ERROR:", error); return; }

  for (const app of apps || []) {
    const gm = (app.generation_meta || {}) as Record<string, unknown>;
    const bm = (app.bid_meta || {}) as Record<string, unknown>;
    console.log(`\n#${app.id} ${app.company}  [${app.apply}]`);
    console.log(`  applied_at:       ${app.applied_at}`);
    console.log(`  created_at:       ${app.created_at}`);
    console.log(`  gen completedAt:  ${gm.completedAt ?? "—"}`);
    console.log(`  bid_state:        ${app.bid_state ?? "—"}`);
    console.log(`  bid_claimed_at:   ${app.bid_claimed_at ?? "—"}`);
    console.log(`  bid_meta times:   ${JSON.stringify({ submittedAt: bm.submittedAt, confirmedAt: bm.confirmedAt, finishedAt: bm.finishedAt })}`);
    const a = Date.parse(app.applied_at);
    const c = Date.parse(app.created_at);
    if (Number.isFinite(a) && Number.isFinite(c)) {
      console.log(`  applied_at - created_at: ${((a - c) / 1000).toFixed(1)}s`);
    }
  }
}

main().catch(console.error);
