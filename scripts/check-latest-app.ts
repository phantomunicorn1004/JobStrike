import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(url, key);

const getText = (f: unknown): string => {
  if (typeof f === "string") return f;
  if (typeof f === "object" && f !== null) return String((f as any).text ?? "");
  return "";
};

async function main() {
  // Get the most recent applications
  const { data: apps } = await supabase
    .from("resume_db_applications")
    .select("id, profile_id, company, job_title, generation_status, generation_error, generation_meta, built_resume_json, bid_state, apply, created_at")
    .order("created_at", { ascending: false })
    .limit(5);

  if (!apps?.length) { console.log("No apps"); return; }

  for (const app of apps) {
    console.log(`\n=== #${app.id} ${app.company} (profile=${app.profile_id}) ===`);
    console.log(`  Job: ${app.job_title}`);
    console.log(`  Created: ${app.created_at}`);
    console.log(`  Gen status: ${app.generation_status}`);
    console.log(`  Bid state: ${app.bid_state}`);
    console.log(`  Apply: ${app.apply}`);

    const gm = app.generation_meta as any;
    if (gm) {
      console.log(`  Gen meta: errors=${JSON.stringify(gm.errors ?? [])}`);
      console.log(`  Gen meta: warnings=${JSON.stringify(gm.warnings ?? [])}`);
      console.log(`  Gen meta: restored=${JSON.stringify(gm.restored ?? [])}`);
      console.log(`  Gen meta: autoRetryCount=${gm.autoRetryCount ?? "none"}`);
    }
    if (app.generation_error) {
      console.log(`  Gen error: ${app.generation_error.slice(0, 300)}`);
    }

    if (app.built_resume_json) {
      try {
        const resume = JSON.parse(app.built_resume_json);
        console.log(`\n  --- Resume JSON fields ---`);
        console.log(`  summary: "${getText(resume.summary).slice(0, 100)}..."`);

        const work = resume.work_experience || {};
        for (const ek of Object.keys(work).filter(k => k.startsWith("experience_")).sort()) {
          const role = work[ek] as Record<string, unknown>;
          console.log(`  ${ek}:`);
          console.log(`    company: "${getText(role.company)}"`);
          console.log(`    role_title: "${getText(role.role_title)}"`);
          console.log(`    location: "${getText(role.location)}"`);
          console.log(`    work_arrangement: "${getText(role.work_arrangement)}"`);
          console.log(`    start_date: "${getText(role.start_date)}"`);
          console.log(`    end_date: "${getText(role.end_date)}"`);
          // Check raw field structure
          console.log(`    company_raw: ${JSON.stringify(role.company)}`);
          console.log(`    role_title_raw: ${JSON.stringify(role.role_title)}`);
        }

        const tech = resume.technology_stack || {};
        for (const key of Object.keys(tech).filter(k => k.startsWith("skill_group")).sort()) {
          console.log(`  ${key}: "${getText(tech[key])}"`);
        }
      } catch (e) {
        console.log(`  (parse error: ${e})`);
      }
    } else {
      console.log(`  (no built_resume_json)`);
    }
  }
}

main().catch(console.error);
