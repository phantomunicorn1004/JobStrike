import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(url, key);

async function main() {
  const { data: row } = await supabase
    .from("resume_db_applications")
    .select("built_resume_json")
    .eq("id", 2819)
    .single();

  const data = JSON.parse(row?.built_resume_json || "{}");

  // Top-level keys
  console.log("=== Top-level keys ===");
  for (const key of Object.keys(data)) {
    const val = data[key];
    const type = Array.isArray(val) ? `array[${val.length}]` : typeof val;
    const preview = typeof val === "string" ? val.slice(0, 80) :
                    typeof val === "object" && val !== null ? JSON.stringify(val).slice(0, 80) : String(val);
    console.log(`  ${key}: ${type} = ${preview}`);
  }

  // Look for experience-related keys at any level
  const jsonStr = row?.built_resume_json || "";
  console.log("\n=== Searching for company names ===");
  for (const name of ["CircleCI", "Sourcegraph", "Sentry", "Extracted Company", "City, ST", "[JD"]) {
    const idx = jsonStr.indexOf(name);
    if (idx >= 0) {
      console.log(`  "${name}" at ${idx}: ...${jsonStr.slice(Math.max(0,idx-40), idx+name.length+40)}...`);
    } else {
      console.log(`  "${name}": NOT FOUND`);
    }
  }

  // Find the section with role_title or Company placeholders
  console.log("\n=== Role-Title placeholders in JSON ===");
  const roleTitleRe = /Role-Title|Company-\d|Company_\d|experience_\d/gi;
  let match;
  while ((match = roleTitleRe.exec(jsonStr)) !== null) {
    const ctx = jsonStr.slice(Math.max(0, match.index - 30), match.index + match[0].length + 50);
    console.log(`  at ${match.index}: ...${ctx}...`);
    if (roleTitleRe.lastIndex > match.index + 200) break; // safety
  }

  // Now check the auto-bid claim/step log for row #2819
  console.log("\n=== Checking autobid_jobs for #2819 ===");
  const { data: bidJob, error: bidErr } = await supabase
    .from("autobid_jobs")
    .select("*")
    .eq("application_id", 2819)
    .limit(5);

  if (bidErr) {
    console.log("  autobid_jobs query error:", bidErr.message);
    // Try with different table/column
    const { data: bidJob2, error: bidErr2 } = await supabase
      .from("autobid_queue")
      .select("*")
      .eq("application_id", 2819)
      .limit(5);
    if (bidErr2) {
      console.log("  autobid_queue error:", bidErr2.message);
    } else {
      console.log("  autobid_queue:", JSON.stringify(bidJob2, null, 2));
    }
  } else {
    console.log("  autobid_jobs:", JSON.stringify(bidJob, null, 2));
  }
}

main().catch(console.error);
