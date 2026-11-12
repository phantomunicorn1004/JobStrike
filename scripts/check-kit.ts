import { createClient } from "@supabase/supabase-js";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function main() {
  const { data: row } = await sb
    .from("resume_db_applications")
    .select("profile_id")
    .eq("id", 2819)
    .single();

  console.log("profile_id:", row?.profile_id);

  // The kit JSON is in profile_prompt_kits.resume_template_json
  const { data: pkRow, error: pkErr } = await sb
    .from("profile_prompt_kits")
    .select("resume_template_json")
    .eq("profile_id", row!.profile_id)
    .maybeSingle();

  if (pkErr) { console.log("ERROR:", pkErr.message); return; }
  if (!pkRow) { console.log("No prompt kit found"); return; }

  const kit = JSON.parse(pkRow.resume_template_json);
  const we = kit.work_experience;
  if (we) {
    for (const [role, data] of Object.entries(we) as [string, any][]) {
      if (!role.startsWith("experience_")) continue;
      console.log(`Kit ${role}: company="${data?.company?.text}", role_title="${data?.role_title?.text}", location="${data?.location?.text}"`);
    }
  }

  // Search for rows that had placeholder or wrong content
  console.log("\n=== Searching for rows with suspect content in built_resume_json ===");
  const suspects = ["Extracted Company", "MLOps", "[JD Role Family]"];
  for (const term of suspects) {
    const { data: matches, error: matchErr } = await sb
      .from("resume_db_applications")
      .select("id, company, job_title, generation_status, applied_at")
      .like("built_resume_json", `%${term}%`)
      .order("id", { ascending: false })
      .limit(10);
    if (matchErr) {
      console.log(`  "${term}": ERROR - ${matchErr.message}`);
    } else if (!matches?.length) {
      console.log(`  "${term}": NONE found`);
    } else {
      console.log(`  "${term}": FOUND in ${matches.length} row(s):`);
      for (const r of matches) {
        console.log(`    #${r.id} ${r.company} | ${r.job_title} | status=${r.generation_status} applied=${r.applied_at}`);
      }
    }
  }

  // Check rows generated around the same time as #2819
  console.log("\n=== Rows applied near #2819 (15:45-16:00 UTC on Nov 12) ===");
  const { data: nearby } = await sb
    .from("resume_db_applications")
    .select("id, company, job_title, generation_meta, applied_at, bid_state")
    .eq("generation_status", "completed")
    .gte("applied_at", "2026-11-12T15:45:00Z")
    .lte("applied_at", "2026-11-12T16:05:00Z")
    .order("applied_at");
  for (const r of nearby ?? []) {
    const gm = r.generation_meta ?? {};
    console.log(`  #${r.id} ${(r.company ?? "").padEnd(25)} completed=${gm.completedAt} applied=${r.applied_at} bid=${r.bid_state}`);
  }

  // Check rows with multiple attempts
  console.log("\n=== Profile 4 rows with retries or multiple attempts ===");
  const { data: retried } = await sb
    .from("resume_db_applications")
    .select("id, company, generation_meta, generation_status")
    .eq("profile_id", row!.profile_id)
    .not("generation_meta", "is", null)
    .order("id", { ascending: false })
    .limit(50);
  for (const r of retried ?? []) {
    const gm = r.generation_meta ?? {};
    const retries = gm.autoRetryCount ?? 0;
    const attempts = gm.attempts ?? gm.attempt ?? 0;
    if (retries > 0 || attempts > 1) {
      console.log(`  #${r.id} ${(r.company ?? "").padEnd(25)} retries=${retries} attempts=${attempts} status=${r.generation_status}`);
    }
  }
}

main().catch((e) => console.error("FATAL:", e));
