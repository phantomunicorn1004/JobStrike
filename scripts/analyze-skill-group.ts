import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(url, key);

async function main() {
  // 1. Check all kits' technology_stack / skill_group fields
  console.log("=== KIT SKILL GROUP FIELDS ===\n");
  const { data: kits } = await supabase
    .from("profile_prompt_kits")
    .select("profile_id, resume_template_json, updated_at")
    .order("updated_at", { ascending: false })
    .limit(10);

  if (!kits?.length) { console.log("No kits"); return; }

  const getText = (f: unknown): string => {
    if (typeof f === "string") return f;
    if (typeof f === "object" && f !== null) return String((f as any).text ?? "");
    return "";
  };

  for (const kit of kits) {
    console.log(`\nProfile ${kit.profile_id} (updated: ${kit.updated_at}):`);
    if (!kit.resume_template_json) { console.log("  (empty)"); continue; }
    const json = JSON.parse(kit.resume_template_json);
    const tech = json.technology_stack || json.skills || {};
    for (const key of Object.keys(tech).sort()) {
      const val = getText(tech[key]);
      console.log(`  ${key}: "${val.slice(0, 120)}${val.length > 120 ? "..." : ""}"`);
    }
  }

  // 2. Look at the 7 failing applications
  console.log("\n\n=== FAILING APPLICATIONS (Skill-Group-1 error) ===\n");
  const failIds = [2750, 2748, 2745, 2744, 2736, 2729, 2726];
  const { data: fails } = await supabase
    .from("resume_db_applications")
    .select("id, profile_id, company, job_title, generation_status, generation_error, generation_meta, built_resume_json, created_at")
    .in("id", failIds);

  if (!fails?.length) { console.log("No results"); return; }

  for (const r of fails.sort((a, b) => b.id - a.id)) {
    console.log(`\n--- #${r.id} ${r.company} (profile=${r.profile_id}) ---`);
    console.log(`  Job: ${r.job_title}`);
    console.log(`  Status: ${r.generation_status}`);
    console.log(`  Error: ${r.generation_error?.slice(0, 300)}`);
    const gm = r.generation_meta as any;
    if (gm) {
      console.log(`  autoRetryCount: ${gm.autoRetryCount ?? "none"}`);
      console.log(`  warnings: ${JSON.stringify(gm.warnings ?? [])}`);
    }

    // Check built_resume_json for the skill_group_1 field
    if (r.built_resume_json) {
      try {
        const resume = JSON.parse(r.built_resume_json);
        const tech = resume.technology_stack || resume.skills || {};
        const sg1 = tech.skill_group_1;
        const si1 = tech.skill_items_1;
        const sg2 = tech.skill_group_2;
        const si2 = tech.skill_items_2;
        console.log(`  resume.skill_group_1: ${JSON.stringify(sg1)}`);
        console.log(`  resume.skill_items_1: ${JSON.stringify(si1)}`);
        if (sg2) console.log(`  resume.skill_group_2: ${JSON.stringify(sg2)}`);
        if (si2) console.log(`  resume.skill_items_2: ${JSON.stringify(si2)}`);
      } catch {
        console.log("  (could not parse built_resume_json)");
      }
    } else {
      console.log("  (no built_resume_json — failed before saving)");
    }
  }

  // 3. Find a SUCCESSFUL app from the same profile to compare
  console.log("\n\n=== SUCCESSFUL APPS FOR COMPARISON ===\n");
  const sampleProfile = fails[0]?.profile_id;
  const { data: successes } = await supabase
    .from("resume_db_applications")
    .select("id, profile_id, company, job_title, built_resume_json")
    .eq("profile_id", sampleProfile || 4)
    .eq("generation_status", "completed")
    .order("created_at", { ascending: false })
    .limit(3);

  if (successes?.length) {
    for (const r of successes) {
      if (!r.built_resume_json) continue;
      console.log(`#${r.id} ${r.company} (profile=${r.profile_id}):`);
      const resume = JSON.parse(r.built_resume_json);
      const tech = resume.technology_stack || resume.skills || {};
      for (const key of Object.keys(tech).sort()) {
        const val = getText(tech[key]);
        console.log(`  ${key}: "${val.slice(0, 150)}"`);
      }
      console.log();
    }
  }

  // 4. Show the full finalize check comparison for a failure
  console.log("\n=== STEP 4 COMPARISON: KIT vs MODEL for a failure ===\n");
  const mostRecent = fails.sort((a, b) => b.id - a.id)[0];
  if (mostRecent?.built_resume_json) {
    const resume = JSON.parse(mostRecent.built_resume_json);
    const kitRow = kits.find(k => k.profile_id === mostRecent.profile_id);
    if (kitRow?.resume_template_json) {
      const kit = JSON.parse(kitRow.resume_template_json);
      const kitTech = kit.technology_stack || kit.skills || {};
      const resTech = resume.technology_stack || resume.skills || {};
      console.log("Kit technology_stack:");
      for (const key of Object.keys(kitTech).sort()) {
        const obj = kitTech[key];
        console.log(`  ${key}: placeholder="${obj?.placeholder}", text="${getText(obj).slice(0, 150)}"`);
      }
      console.log("\nModel technology_stack:");
      for (const key of Object.keys(resTech).sort()) {
        const obj = resTech[key];
        console.log(`  ${key}: placeholder="${obj?.placeholder}", text="${getText(obj).slice(0, 150)}"`);
      }
      // Show the exact comparison the step 4 check does
      console.log("\nStep 4 check details for <<Skill-Group-1>>:");
      const kitSG1 = kitTech.skill_group_1;
      const resSG1 = resTech.skill_group_1;
      const kitText = typeof kitSG1?.text === "string" ? kitSG1.text : "";
      const resText = typeof resSG1?.text === "string" ? resSG1.text : "";
      console.log(`  kitText: "${kitText}" (length=${kitText.length})`);
      console.log(`  resText: "${resText}" (length=${resText.length})`);
      console.log(`  kitText.trim().length > 20: ${kitText.trim().length > 20}`);
      console.log(`  text === kitText: ${resText.trim() === kitText.trim()}`);
      console.log(`  -> Would trigger: ${kitText.trim().length > 20 && resText.trim() === kitText.trim()}`);
    }
  }
}

main().catch(console.error);
