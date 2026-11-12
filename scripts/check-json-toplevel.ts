import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(url, key);

async function main() {
  const { data: app } = await supabase
    .from("resume_db_applications")
    .select("id, company, built_resume_json")
    .eq("id", 2757)
    .single();

  if (!app?.built_resume_json) { console.log("No data"); return; }
  const resume = JSON.parse(app.built_resume_json);

  console.log("=== TOP-LEVEL KEYS ===");
  console.log(Object.keys(resume).join(", "));

  console.log("\n=== is_template_json check fields ===");
  console.log(`  schema_version: ${JSON.stringify(resume.schema_version)}`);
  console.log(`  template_name: ${JSON.stringify(resume.template_name)}`);
  console.log(`  placeholder_order: ${JSON.stringify(resume.placeholder_order?.slice?.(0, 5))}`);
  console.log(`  profile_title: ${JSON.stringify(resume.profile_title)}`);
  console.log(`  resume_template: ${JSON.stringify(resume.resume_template)}`);
  console.log(`  candidate: ${JSON.stringify(resume.candidate)}`);

  // Check if "resume" section exists (non-template format)
  console.log(`\n  Has "resume" section: ${!!resume.resume}`);
  console.log(`  Has "cover_letter" section: ${!!resume.cover_letter}`);

  // Sample the work_experience structure briefly
  const work = resume.work_experience || {};
  const ek = Object.keys(work).filter(k => k.startsWith("experience_"))[0];
  if (ek) {
    console.log(`\n=== ${ek} date fields ===`);
    const role = work[ek] as Record<string, unknown>;
    console.log(`  start_date: ${JSON.stringify(role.start_date)}`);
    console.log(`  end_date: ${JSON.stringify(role.end_date)}`);
    console.log(`  date_range: ${JSON.stringify(role.date_range)}`);
  }
}

main().catch(console.error);
