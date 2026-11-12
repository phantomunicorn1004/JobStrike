import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(url, key);

async function main() {
  // Find all completed apps with placeholder text in built_resume_json
  const { data: apps } = await supabase
    .from("resume_db_applications")
    .select("id, company, job_title, built_resume_json, apply, bid_state, generation_status")
    .eq("generation_status", "completed")
    .order("created_at", { ascending: false })
    .limit(500);

  if (!apps?.length) { console.log("No apps found"); return; }

  const bad = apps.filter(a =>
    a.built_resume_json &&
    /Extracted Company|\[JD[\s\w]*\]|"City, ST"/i.test(a.built_resume_json)
  );

  if (!bad.length) {
    console.log("No apps with placeholder text found. All clean!");
    return;
  }

  console.log(`Found ${bad.length} apps with placeholder text:\n`);
  for (const a of bad) {
    console.log(`  #${a.id} ${a.company} — "${a.job_title}" (apply=${a.apply}, bid=${a.bid_state})`);
  }

  const ids = bad.map(a => a.id);
  console.log(`\nRe-queuing ${ids.length} apps for regeneration: [${ids.join(", ")}]`);

  // Reset them to queue status so they regenerate with the new kit.
  // Also clear Drive file references so the stale DOCX is not served.
  const { data: updated, error } = await supabase
    .from("resume_db_applications")
    .update({
      generation_status: "queue",
      generation_error: "",
      autogen_claimed_at: null,
      built_resume_json: null,
      resume_drive_file_id: null,
      resume_url: null,
      cover_letter_drive_file_id: null,
      cover_letter_url: null,
    })
    .in("id", ids)
    .select("id");

  if (error) {
    console.error("Error:", error);
    return;
  }

  console.log(`\nDone — ${updated?.length ?? 0} apps re-queued for regeneration.`);
}

main().catch(console.error);
