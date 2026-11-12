import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(url, key);

async function main() {
  // 1. Check row 2819's timestamps — was built_resume_json updated after registration?
  const { data: row, error } = await supabase
    .from("resume_db_applications")
    .select("id, company, job_title, created_at, applied_at, bid_state, bid_meta, generation_status, built_resume_json")
    .eq("id", 2819)
    .single();
  if (error) { console.error("ERROR:", error); return; }

  console.log("=== Row #2819 timestamps ===");
  console.log("created_at:", row.created_at);
  console.log("applied_at:", row.applied_at);
  console.log("bid_state:", row.bid_state);
  console.log("generation_status:", row.generation_status);
  const meta = row.bid_meta ?? {};
  console.log("bid_meta.confirmedAt:", meta.confirmedAt);
  console.log("bid_meta.registeredAt:", meta.registeredAt);
  console.log("bid_meta.finishedAt:", meta.finishedAt);

  // 2. Check if built_resume_json contains any placeholder text NOW
  const json = row.built_resume_json || "";
  console.log("\n=== Placeholder check in built_resume_json ===");
  for (const phrase of ["Extracted Company", "[JD Role Family]", "[JD", "City, ST", "Terraform", "MLflow", "Bicep", "Azure DevOps", "CircleCI", "Sourcegraph", "Sentry"]) {
    console.log(`  "${phrase}": ${json.includes(phrase) ? "FOUND" : "not found"}`);
  }

  // 3. Check rows around the same time
  const { data: nearby } = await supabase
    .from("resume_db_applications")
    .select("id, company, job_title, applied_at, created_at, bid_state, bid_meta")
    .gte("created_at", "2026-11-12T14:00:00Z")
    .lte("created_at", "2026-11-12T17:00:00Z")
    .order("created_at", { ascending: true });

  console.log("\n=== Rows created near #2819 (14:00-17:00 UTC Nov 12) ===");
  for (const r of nearby ?? []) {
    const m = r.bid_meta ?? {};
    console.log(`  #${r.id} ${(r.company ?? "").padEnd(25)} ${(r.job_title ?? "").padEnd(40).slice(0,40)} state=${r.bid_state ?? "?"} created=${r.created_at} applied=${r.applied_at ?? "null"} confirmed=${m.confirmedAt ?? "null"}`);
  }

  // 4. Today's submitted bids — check for Terraform/MLflow content
  const { data: submitted } = await supabase
    .from("resume_db_applications")
    .select("id, company, job_title, built_resume_json, applied_at, bid_meta")
    .eq("bid_state", "submitted")
    .gte("applied_at", "2026-11-12T00:00:00Z")
    .order("applied_at", { ascending: false })
    .limit(20);

  console.log("\n=== Today's submitted bids — checking for Terraform/MLflow ===");
  for (const r of submitted ?? []) {
    const j = r.built_resume_json || "";
    const hasTerraform = j.includes("Terraform");
    const hasMLflow = j.includes("MLflow");
    const hasBicep = j.includes("Bicep");
    const hasExtracted = j.includes("Extracted Company");
    const hasJDRole = j.includes("[JD");
    const m = r.bid_meta ?? {};
    const flag = (hasTerraform || hasMLflow || hasBicep || hasExtracted || hasJDRole) ? "MATCH" : "no match";
    console.log(`  #${r.id} ${(r.company ?? "").padEnd(25)} ${(r.job_title ?? "").slice(0,35).padEnd(35)} ${flag} terraform=${hasTerraform} confirmed=${m.confirmedAt ?? "null"}`);
  }

  // 5. Search for "Extracted Company" in ANY built_resume_json
  const { data: anyExtracted } = await supabase
    .from("resume_db_applications")
    .select("id, company, job_title, bid_state, applied_at")
    .ilike("built_resume_json", "%Extracted Company%")
    .order("id", { ascending: false })
    .limit(10);

  console.log("\n=== Rows with 'Extracted Company' in built_resume_json ===");
  if (!anyExtracted?.length) {
    console.log("  NONE — no row currently has 'Extracted Company' in its JSON");
  } else {
    for (const r of anyExtracted ?? []) {
      console.log(`  #${r.id} ${(r.company ?? "").padEnd(25)} ${r.job_title} state=${r.bid_state} applied=${r.applied_at}`);
    }
  }

  // 6. Check rows with generation_status != null near this time
  const { data: generating } = await supabase
    .from("resume_db_applications")
    .select("id, company, job_title, generation_status, created_at")
    .not("generation_status", "is", null)
    .gte("created_at", "2026-11-12T14:00:00Z")
    .order("created_at", { ascending: false })
    .limit(10);

  console.log("\n=== Recent rows with generation_status set ===");
  for (const r of generating ?? []) {
    console.log(`  #${r.id} ${(r.company ?? "").padEnd(25)} ${(r.job_title ?? "").slice(0,35)} status=${r.generation_status} created=${r.created_at}`);
  }
}

main().catch(console.error);
