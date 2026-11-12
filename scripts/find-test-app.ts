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
  // Search for the test app - look for recently registered apps
  console.log("=== RECENTLY REGISTERED APPS ===\n");
  const { data: registered } = await supabase
    .from("resume_db_applications")
    .select("id, profile_id, company, job_title, generation_status, generation_meta, built_resume_json, bid_state, apply, created_at")
    .eq("apply", "Registered")
    .order("created_at", { ascending: false })
    .limit(5);

  for (const app of registered || []) {
    console.log(`#${app.id} ${app.company} — "${app.job_title}" (${app.created_at.slice(0, 16)})`);
    console.log(`  profile=${app.profile_id}, gen=${app.generation_status}, bid=${app.bid_state}`);
    if (app.built_resume_json) {
      const resume = JSON.parse(app.built_resume_json);
      const work = resume.work_experience || {};
      for (const ek of Object.keys(work).filter(k => k.startsWith("experience_")).sort()) {
        const role = work[ek] as Record<string, unknown>;
        const hasPlaceholder = /Extracted Company|\[JD|City,\s*ST/i.test(
          `${getText(role.company)}|${getText(role.role_title)}|${getText(role.location)}`
        );
        console.log(`  ${ek}: company="${getText(role.company)}", title="${getText(role.role_title)}", loc="${getText(role.location)}" ${hasPlaceholder ? "⚠️ PLACEHOLDER!" : "✓"}`);
      }
    }
  }

  // Also search for any app with "Extracted Company" or "[JD Role Family]" in built_resume_json in last 48h
  console.log("\n\n=== APPS WITH PLACEHOLDER TEXT IN RESUME (last 48h) ===\n");
  const cutoff = new Date(Date.now() - 48 * 3600_000).toISOString();
  const { data: recent } = await supabase
    .from("resume_db_applications")
    .select("id, profile_id, company, job_title, generation_status, generation_meta, built_resume_json, apply, created_at")
    .gte("created_at", cutoff)
    .eq("generation_status", "completed")
    .order("created_at", { ascending: false })
    .limit(300);

  let found = 0;
  for (const app of recent || []) {
    if (!app.built_resume_json) continue;
    if (!/Extracted Company|\[JD[\s\w]*\]|"City, ST"/i.test(app.built_resume_json)) continue;
    found++;
    console.log(`#${app.id} ${app.company} — "${app.job_title}" (${app.created_at.slice(0, 16)})`);
    console.log(`  profile=${app.profile_id}, apply=${app.apply}`);
    const gm = app.generation_meta as any;
    console.log(`  warnings: ${JSON.stringify(gm?.warnings ?? [])}`);
    console.log(`  restored: ${JSON.stringify(gm?.restored ?? [])}`);
    const resume = JSON.parse(app.built_resume_json);
    const work = resume.work_experience || {};
    for (const ek of Object.keys(work).filter(k => k.startsWith("experience_")).sort()) {
      const role = work[ek] as Record<string, unknown>;
      console.log(`  ${ek}: company="${getText(role.company)}", title="${getText(role.role_title)}", loc="${getText(role.location)}"`);
    }
    console.log();
  }
  if (!found) console.log("None found — all recent completed resumes are clean.");

  // Search for DV Trading or MLOps in recent apps
  console.log("\n\n=== SEARCH: DV Trading / MLOps / Systems Engineer ===\n");
  const { data: search } = await supabase
    .from("resume_db_applications")
    .select("id, profile_id, company, job_title, generation_status, built_resume_json, apply, created_at")
    .order("created_at", { ascending: false })
    .limit(300);

  for (const app of search || []) {
    if (!app.built_resume_json) continue;
    if (/DV Trading|MLOps|latency.sensitive/i.test(app.built_resume_json)) {
      console.log(`#${app.id} ${app.company} — "${app.job_title}" (${app.created_at.slice(0, 16)}) apply=${app.apply}`);
      const resume = JSON.parse(app.built_resume_json);
      console.log(`  summary: "${getText(resume.summary).slice(0, 120)}..."`);
      const work = resume.work_experience || {};
      for (const ek of Object.keys(work).filter(k => k.startsWith("experience_")).sort()) {
        const role = work[ek] as Record<string, unknown>;
        console.log(`  ${ek}: company="${getText(role.company)}", title="${getText(role.role_title)}"`);
      }
      console.log();
    }
  }
}

main().catch(console.error);
