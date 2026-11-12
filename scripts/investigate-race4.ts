import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(url, key);

async function main() {
  // 1. Check the prompt_kit for row 2819's profile to see what values it uses
  const { data: row } = await supabase
    .from("resume_db_applications")
    .select("id, profile_id")
    .eq("id", 2819)
    .single();

  if (row?.profile_id) {
    const { data: profile } = await supabase
      .from("resume_db_profiles")
      .select("id, full_name, prompt_kit")
      .eq("id", row.profile_id)
      .single();

    if (profile?.prompt_kit) {
      const kit = profile.prompt_kit;
      console.log("=== Profile prompt_kit ===");
      console.log(`Profile #${profile.id} "${profile.full_name}" kit_size=${kit.length}`);
      for (const phrase of ["Extracted Company", "[JD Role Family]", "[JD", "City, ST"]) {
        const idx = kit.indexOf(phrase);
        if (idx >= 0) {
          const context = kit.slice(Math.max(0,idx-40), idx+phrase.length+40);
          console.log(`  FOUND "${phrase}" at ${idx}: ...${context}...`);
        } else {
          console.log(`  NOT FOUND: "${phrase}"`);
        }
      }
    } else {
      console.log("Profile has no prompt_kit");
    }
  }

  // 2. Check the autobid step log and bid_meta for #2819
  const { data: bidRow } = await supabase
    .from("resume_db_applications")
    .select("bid_state, bid_meta, generation_meta")
    .eq("id", 2819)
    .single();

  console.log("\n=== Row #2819 bid_meta ===");
  console.log(JSON.stringify(bidRow?.bid_meta, null, 2));

  console.log("\n=== Row #2819 generation_meta ===");
  console.log(JSON.stringify(bidRow?.generation_meta, null, 2));

  // 3. Check the autobid table structure
  const tables = ["autobid_claims", "autobid_steps", "autobid_log", "autobid_bids"];
  for (const t of tables) {
    const { error } = await supabase.from(t).select("id").limit(1);
    console.log(`\nTable "${t}": ${error ? `ERROR: ${error.message}` : "EXISTS"}`);
  }

  // 4. Check if there are any rows whose built_resume_json was recently modified
  // by looking at generation_meta for retry info
  const { data: recentCompleted } = await supabase
    .from("resume_db_applications")
    .select("id, company, job_title, generation_meta, bid_state, applied_at")
    .eq("generation_status", "completed")
    .gte("applied_at", "2026-11-12T14:00:00Z")
    .order("applied_at", { ascending: false })
    .limit(10);

  console.log("\n=== Recent completed generations (check for retries) ===");
  for (const r of recentCompleted ?? []) {
    const meta = r.generation_meta ?? {};
    const retryCount = meta.autoRetryCount ?? 0;
    const engine = meta.engine ?? "?";
    const attempts = meta.attempts ?? meta.attempt ?? "?";
    console.log(`  #${r.id} ${(r.company ?? "").padEnd(25)} retries=${retryCount} engine=${engine} attempts=${attempts} bid=${r.bid_state} applied=${r.applied_at}`);
  }

  // 5. Check if #2819 had multiple generation attempts
  const { data: row2819Full } = await supabase
    .from("resume_db_applications")
    .select("generation_meta, generation_error")
    .eq("id", 2819)
    .single();

  console.log("\n=== Row #2819 full generation_meta ===");
  const genMeta = row2819Full?.generation_meta;
  if (genMeta) {
    for (const [k, v] of Object.entries(genMeta)) {
      console.log(`  ${k}: ${JSON.stringify(v)}`);
    }
  }
  console.log("generation_error:", row2819Full?.generation_error);
}

main().catch(console.error);
