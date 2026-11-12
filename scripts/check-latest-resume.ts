import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(url, key);

async function main() {
  // The GitLab row the user saw
  const { data, error } = await supabase
    .from("resume_db_applications")
    .select("id, company, job_title, resume_url, cover_letter_url, resume_storage_path, cover_letter_storage_path, resume_drive_file_id, cover_drive_file_id, bid_state, bid_meta, applied_at, created_at")
    .eq("id", 2819)
    .single();
  if (error) { console.error("QUERY ERROR:", error); return; }

  console.log("=== Row #2819 ===");
  console.log("company:", data.company);
  console.log("job_title:", data.job_title);
  console.log("bid_state:", data.bid_state);
  console.log("applied_at:", data.applied_at);
  console.log("created_at:", data.created_at);
  console.log("\nresume_url:", data.resume_url);
  console.log("cover_letter_url:", data.cover_letter_url);
  console.log("resume_storage_path:", data.resume_storage_path);
  console.log("cover_letter_storage_path:", data.cover_letter_storage_path);
  console.log("resume_drive_file_id:", data.resume_drive_file_id);
  console.log("cover_drive_file_id:", data.cover_drive_file_id);

  const meta = data.bid_meta ?? {};
  console.log("\nbid_meta.registeredAt:", meta.registeredAt);
  console.log("bid_meta.method:", meta.method);
  console.log("bid_meta.confirmedAt:", meta.confirmedAt);
  console.log("bid_meta.finishedAt:", meta.finishedAt);

  // Also check another recent submitted row for comparison
  const { data: others } = await supabase
    .from("resume_db_applications")
    .select("id, company, resume_url, resume_drive_file_id")
    .eq("bid_state", "submitted")
    .order("applied_at", { ascending: false })
    .limit(5);

  console.log("\n=== Recent submitted bids' resume_url ===");
  for (const r of others ?? []) {
    console.log(`  #${r.id} ${(r.company ?? "").padEnd(25)} drive_id=${r.resume_drive_file_id ?? "(null)"} url=${(r.resume_url ?? "").slice(0, 80)}`);
  }
}

main().catch(console.error);
