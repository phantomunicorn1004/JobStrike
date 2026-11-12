import { createClient } from "@supabase/supabase-js";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function main() {
  const { data } = await sb
    .from("resume_db_applications")
    .select("resume_url, resume_drive_file_id, cover_letter_url, cover_letter_drive_file_id, bid_meta, applied_at, generation_meta")
    .eq("id", 2819)
    .single();

  console.log("resume_url:", data?.resume_url);
  console.log("resume_drive_file_id:", data?.resume_drive_file_id);
  console.log("cover_letter_url:", data?.cover_letter_url);
  console.log("cover_letter_drive_file_id:", data?.cover_letter_drive_file_id);

  // Check rows that were generated in the same session, around the same time
  const { data: nearby } = await sb
    .from("resume_db_applications")
    .select("id, company, job_title, resume_drive_file_id, applied_at, generation_meta, bid_state")
    .gte("applied_at", "2026-11-12T15:00:00Z")
    .lte("applied_at", "2026-11-12T16:30:00Z")
    .not("resume_drive_file_id", "is", null)
    .order("applied_at");

  console.log("\n=== Rows with Drive files applied on Nov 12 15:00-16:30 ===");
  for (const r of nearby ?? []) {
    const gm = r.generation_meta ?? {};
    console.log(`  #${r.id} ${(r.company ?? "").padEnd(25)} drive=${r.resume_drive_file_id?.slice(0, 15)}... applied=${r.applied_at} gen_completed=${gm.completedAt}`);
  }

  // Check if any rows share a drive file ID with 2819
  if (data?.resume_drive_file_id) {
    const { data: dupes } = await sb
      .from("resume_db_applications")
      .select("id, company")
      .eq("resume_drive_file_id", data.resume_drive_file_id)
      .neq("id", 2819);

    if (dupes?.length) {
      console.log("\n=== DUPLICATE Drive file ID! ===");
      for (const d of dupes) console.log(`  #${d.id} ${d.company}`);
    } else {
      console.log("\nNo duplicate Drive file IDs — file is unique to row #2819.");
    }
  }
}

main().catch((e) => console.error("FATAL:", e));
