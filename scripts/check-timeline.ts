import { createClient } from "@supabase/supabase-js";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function main() {
  // Row #2819 full details
  const { data: row } = await sb
    .from("resume_db_applications")
    .select("id, company, job_title, created_at, applied_at, generation_status, generation_meta, bid_state, bid_meta, resume_drive_file_id, resume_url")
    .eq("id", 2819)
    .single();

  if (!row) { console.log("Row not found"); return; }

  console.log("=== Row #2819 ===");
  console.log("company:", row.company);
  console.log("job_title:", row.job_title);
  console.log("created_at:", row.created_at);
  console.log("applied_at:", row.applied_at);
  console.log("generation_status:", row.generation_status);
  console.log("bid_state:", row.bid_state);
  console.log("resume_drive_file_id:", row.resume_drive_file_id);
  console.log("resume_url:", row.resume_url);
  console.log("\ngeneration_meta:", JSON.stringify(row.generation_meta, null, 2));
  console.log("\nbid_meta:", JSON.stringify(row.bid_meta, null, 2));

  // All profile 4 rows with Drive files — sorted by applied_at
  const { data: allWithDrive } = await sb
    .from("resume_db_applications")
    .select("id, company, job_title, created_at, applied_at, generation_status, generation_meta, bid_state, resume_drive_file_id")
    .eq("profile_id", 4)
    .not("resume_drive_file_id", "is", null)
    .order("applied_at", { ascending: true })
    .limit(50);

  console.log("\n=== Profile 4 rows with Drive files (by applied_at) ===");
  for (const r of allWithDrive ?? []) {
    const gm = r.generation_meta ?? {} as any;
    console.log(`#${r.id} ${(r.company ?? "").padEnd(20)} created=${r.created_at} applied=${r.applied_at} gen_completed=${gm.completedAt ?? "?"} bid=${r.bid_state}`);
  }

  // Profile 4 rows created before the placeholder checks (Nov 11 16:16 UTC = 11:16 EST)
  const { data: earlyRows } = await sb
    .from("resume_db_applications")
    .select("id, company, job_title, created_at, generation_status, generation_meta, bid_state")
    .eq("profile_id", 4)
    .lt("created_at", "2026-11-11T16:16:00Z")
    .order("created_at", { ascending: false })
    .limit(20);

  console.log("\n=== Profile 4 rows created BEFORE placeholder checks (Nov 11 11:16 EST) ===");
  for (const r of earlyRows ?? []) {
    const gm = r.generation_meta ?? {} as any;
    console.log(`#${r.id} ${(r.company ?? "").padEnd(20)} created=${r.created_at} gen_status=${r.generation_status} gen_completed=${gm.completedAt ?? "?"} bid=${r.bid_state}`);
  }

  // Check when profile 4 kit was last updated
  const { data: kit } = await sb
    .from("profile_prompt_kits")
    .select("updated_at, profile_id")
    .eq("profile_id", 4)
    .single();
  if (kit) {
    console.log("\nProfile 4 kit updated_at:", kit.updated_at);
  }
}

main().catch(console.error);
