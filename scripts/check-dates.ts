import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(url, key);

async function main() {
  const { data: apps } = await supabase
    .from("resume_db_applications")
    .select("id, company, built_resume_json")
    .in("id", [2757, 2752, 2737, 2728, 2725]);

  for (const app of apps || []) {
    if (!app.built_resume_json) continue;
    const r = JSON.parse(app.built_resume_json);
    const work = r.work_experience || {};
    console.log(`\n=== #${app.id} ${app.company} ===`);
    for (const ek of Object.keys(work).filter(k => k.startsWith("experience_")).sort()) {
      const role = work[ek] as Record<string, unknown>;
      console.log(`  ${ek}:`);
      console.log(`    start_date: ${JSON.stringify(role.start_date)}`);
      console.log(`    end_date: ${JSON.stringify(role.end_date)}`);
      console.log(`    date_range: ${JSON.stringify(role.date_range)}`);
    }
  }
}

main().catch(console.error);
