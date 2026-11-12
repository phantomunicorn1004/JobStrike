import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(url, key);

async function main() {
  const { data: apps } = await supabase
    .from("resume_db_applications")
    .select("id, company, job_title, built_resume_json")
    .eq("apply", "Registered")
    .order("created_at", { ascending: false })
    .limit(3);

  for (const app of apps || []) {
    if (!app.built_resume_json) continue;
    const resume = JSON.parse(app.built_resume_json);
    console.log(`\n=== #${app.id} ${app.company} ===`);

    const work = resume.work_experience || {};
    for (const ek of Object.keys(work).filter(k => k.startsWith("experience_")).sort()) {
      const role = work[ek] as Record<string, unknown>;
      console.log(`  ${ek}:`);
      console.log(`    company: ${JSON.stringify(role.company)}`);
      console.log(`    role_title: ${JSON.stringify(role.role_title)}`);
      console.log(`    location: ${JSON.stringify(role.location)}`);
    }
  }

  console.log("\n\n=== KIT STRUCTURE (Profile 4) ===\n");
  const { data: kit } = await supabase
    .from("profile_prompt_kits")
    .select("resume_template_json")
    .eq("profile_id", 4)
    .single();

  if (kit?.resume_template_json) {
    const kitJson = JSON.parse(kit.resume_template_json);
    const kitWork = kitJson.work_experience || {};
    for (const ek of Object.keys(kitWork).filter(k => k.startsWith("experience_")).sort()) {
      const role = kitWork[ek] as Record<string, unknown>;
      console.log(`  ${ek}:`);
      console.log(`    company: ${JSON.stringify(role.company)}`);
      console.log(`    role_title: ${JSON.stringify(role.role_title)}`);
      console.log(`    location: ${JSON.stringify(role.location)}`);
    }
  }
}

main().catch(console.error);
