import { createClient } from "@supabase/supabase-js";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function main() {
  const { data: row } = await sb
    .from("resume_db_applications")
    .select("built_resume_json")
    .eq("id", 2819)
    .single();

  if (!row?.built_resume_json) {
    console.log("No built_resume_json for row #2819");
    return;
  }

  const json = JSON.parse(row.built_resume_json);

  // Check work experience company/role_title/location
  const we = json.work_experience || {};
  console.log("=== Work Experience Fields ===\n");
  for (const key of Object.keys(we).sort()) {
    const role = we[key];
    if (typeof role !== "object" || !role) continue;
    const company = role.company;
    const roleTitle = role.role_title;
    const location = role.location;
    const workArr = role.work_arrangement;

    const fieldText = (f: any) => typeof f === "object" && f ? f.text : f;
    const fieldPh = (f: any) => typeof f === "object" && f ? f.placeholder : "(plain string)";

    console.log(`${key}:`);
    console.log(`  company:          text="${fieldText(company)}"  placeholder="${fieldPh(company)}"`);
    console.log(`  role_title:       text="${fieldText(roleTitle)}"  placeholder="${fieldPh(roleTitle)}"`);
    console.log(`  location:         text="${fieldText(location)}"  placeholder="${fieldPh(location)}"`);
    console.log(`  work_arrangement: text="${fieldText(workArr)}"  placeholder="${fieldPh(workArr)}"`);

    // Check bullets
    const bullets = Object.keys(role).filter(k => k.startsWith("bullet_")).sort();
    for (const b of bullets.slice(0, 2)) {
      const text = fieldText(role[b]);
      console.log(`  ${b}: "${(text || "").slice(0, 80)}..."`);
    }
    console.log();
  }

  // Check for ANY "Extracted Company" or "[JD" text anywhere in the JSON
  const jsonStr = JSON.stringify(json);
  const patterns = [/Extracted Company/gi, /\[JD/gi, /City, ST/gi, /Terraform/gi, /Azure/gi, /MLflow/gi];
  console.log("=== Placeholder Text Search ===");
  for (const p of patterns) {
    const matches = jsonStr.match(p);
    console.log(`  ${p.source}: ${matches ? matches.length + " matches" : "NONE"}`);
  }

  // Show the resume_template
  console.log(`\nresume_template: ${json.resume_template}`);
  console.log(`candidate: ${json.candidate}`);
  console.log(`profile_title: ${typeof json.profile_title === "object" ? json.profile_title?.text : json.profile_title}`);
}

main().catch(console.error);
