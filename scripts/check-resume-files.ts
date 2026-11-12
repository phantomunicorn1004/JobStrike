import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(url, key);

async function main() {
  const { data: apps } = await supabase
    .from("resume_db_applications")
    .select("id, company, job_title, apply, resume_url, resume_storage_path, resume_drive_file_id, cover_letter_url, cover_letter_storage_path, cover_drive_file_id, built_resume_json, generation_status, generation_meta")
    .eq("apply", "Registered")
    .order("created_at", { ascending: false })
    .limit(5);

  for (const app of apps || []) {
    console.log(`\n=== #${app.id} ${app.company} — "${app.job_title}" ===`);
    console.log(`  apply: ${app.apply}`);
    console.log(`  gen_status: ${app.generation_status}`);
    console.log(`  resume_url: ${app.resume_url || "(empty)"}`);
    console.log(`  resume_storage_path: ${app.resume_storage_path || "(empty)"}`);
    console.log(`  resume_drive_file_id: ${app.resume_drive_file_id || "(empty)"}`);
    console.log(`  cover_letter_url: ${app.cover_letter_url || "(empty)"}`);
    console.log(`  cover_storage_path: ${app.cover_letter_storage_path || "(empty)"}`);
    console.log(`  has_built_resume_json: ${!!app.built_resume_json}`);
    const gm = app.generation_meta as any;
    if (gm) {
      console.log(`  gen_meta.warnings: ${JSON.stringify(gm.warnings || [])}`);
      console.log(`  gen_meta.restored: ${JSON.stringify(gm.restored || [])}`);
    }
  }
}

main().catch(console.error);
