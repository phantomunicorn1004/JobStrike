import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(url, key);

async function main() {
  // 1. Check if #2819 and #2795 share the same drive file
  const { data: rows } = await supabase
    .from("resume_db_applications")
    .select("id, company, job_title, resume_drive_file_id, resume_url, bid_meta, applied_at")
    .in("id", [2819, 2795, 2755, 2757])
    .order("id");

  console.log("=== Drive file IDs for recent submitted bids ===");
  for (const r of rows ?? []) {
    const m = r.bid_meta ?? {};
    console.log(`  #${r.id} ${(r.company ?? "").padEnd(25)} drive_id=${r.resume_drive_file_id ?? "null"} confirmed=${m.confirmedAt ?? "null"}`);
  }

  // Check for duplicate drive file IDs across ALL rows
  const { data: allDriveIds } = await supabase
    .from("resume_db_applications")
    .select("id, resume_drive_file_id")
    .not("resume_drive_file_id", "is", null)
    .order("id", { ascending: false })
    .limit(100);

  const driveIdMap = new Map<string, number[]>();
  for (const r of allDriveIds ?? []) {
    const id = r.resume_drive_file_id;
    if (!driveIdMap.has(id)) driveIdMap.set(id, []);
    driveIdMap.get(id)!.push(r.id);
  }
  const dupes = [...driveIdMap.entries()].filter(([, ids]) => ids.length > 1);
  console.log("\n=== Duplicate drive file IDs (last 100 rows) ===");
  if (!dupes.length) {
    console.log("  NONE — each row has a unique drive file ID");
  } else {
    for (const [driveId, ids] of dupes) {
      console.log(`  drive_id=${driveId} → rows: ${ids.join(", ")}`);
    }
  }

  // 2. Look at where "Terraform" appears in #2819's JSON
  const { data: row2819 } = await supabase
    .from("resume_db_applications")
    .select("built_resume_json")
    .eq("id", 2819)
    .single();

  const json = row2819?.built_resume_json || "";
  const data = JSON.parse(json);

  console.log("\n=== Row #2819 JSON structure ===");
  console.log("resume_template:", data.resume_template);
  console.log("profile:", data.profile);
  console.log("role_title:", data.role_title);

  // Check experience entries
  if (data.experience) {
    console.log("\nExperience entries:");
    for (let i = 0; i < data.experience.length; i++) {
      const exp = data.experience[i];
      console.log(`  [${i}] company: ${exp.company}, role: ${exp.role_title}, location: ${exp.location}`);
      const bullets = (exp.bullet_points || exp.responsibilities || []).join(" ").slice(0, 100);
      console.log(`       bullets preview: ${bullets}`);
    }
  }

  // Check for Terraform location
  const terraformIdx = json.indexOf("Terraform");
  if (terraformIdx >= 0) {
    const context = json.slice(Math.max(0, terraformIdx - 50), terraformIdx + 60);
    console.log(`\n  "Terraform" found at char ${terraformIdx}, context: ...${context}...`);
  }

  // 3. Look at #2795's JSON for comparison
  const { data: row2795 } = await supabase
    .from("resume_db_applications")
    .select("built_resume_json")
    .eq("id", 2795)
    .single();

  const data2795 = JSON.parse(row2795?.built_resume_json || "{}");
  console.log("\n=== Row #2795 (Govini) JSON structure ===");
  console.log("resume_template:", data2795.resume_template);
  console.log("role_title:", data2795.role_title);
  if (data2795.experience) {
    for (let i = 0; i < data2795.experience.length; i++) {
      const exp = data2795.experience[i];
      console.log(`  [${i}] company: ${exp.company}, role: ${exp.role_title}, location: ${exp.location}`);
    }
  }

  // 4. Check the Profile 4 kit for "Extracted Company" defaults
  const { data: profiles } = await supabase
    .from("resume_db_profiles")
    .select("id, full_name, prompt_kit")
    .order("id");

  console.log("\n=== Profiles with prompt kits ===");
  for (const p of profiles ?? []) {
    const kit = p.prompt_kit || "";
    const hasExtracted = kit.includes("Extracted Company");
    const hasJDRole = kit.includes("[JD Role Family]");
    console.log(`  Profile #${p.id} "${p.full_name}" kit_size=${kit.length} hasExtracted=${hasExtracted} hasJDRole=${hasJDRole}`);
  }
}

main().catch(console.error);
