import { createClient } from "@supabase/supabase-js";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function main() {
  const { data, error } = await sb
    .from("resume_db_applications")
    .select("id, company, ats_platform, bid_fields")
    .eq("bid_state", "submitted")
    .order("id", { ascending: false })
    .limit(25);

  if (error) { console.error(error.message); return; }

  const issues: string[] = [];
  let totalFields = 0;
  let totalAi = 0;

  for (const r of data ?? []) {
    const fields = r.bid_fields as Array<Record<string, unknown>> | null;
    if (!fields) continue;

    for (const f of fields) {
      totalFields++;
      const label = String(f.label || "");
      const value = String(f.value || "");
      const source = String(f.source || "");
      const outcome = String(f.outcome || "");
      const category = String(f.category || "");

      if (source === "ai") totalAi++;

      // Check for wrong answers
      // 1. Resume text in non-text fields
      if (value.length > 100 && /salary|pay|compensation/i.test(label)) {
        issues.push(`[#${r.id} ${r.company}] SALARY FIELD GOT LONG TEXT: "${label}" => "${value.substring(0, 80)}..."`);
      }

      // 2. "Yes" for work auth expiration date
      if (/expir|date/i.test(label) && /auth/i.test(label) && value === "Yes") {
        issues.push(`[#${r.id} ${r.company}] WRONG ANSWER TYPE: "${label}" => "Yes" (should be a date or N/A)`);
      }

      // 3. Address field only has street (missing city/state/zip for full address questions)
      if (/full.*address|mailing.*address/i.test(label) && value && !/\d{5}/.test(value) && !/jacksonville/i.test(value)) {
        issues.push(`[#${r.id} ${r.company}] INCOMPLETE ADDRESS: "${label}" => "${value}" (missing city/state/zip?)`);
      }

      // 4. "Legal First and Last Name" got only last name
      if (/legal.*first.*last|full.*legal/i.test(label) && value && !value.includes(" ")) {
        issues.push(`[#${r.id} ${r.company}] SINGLE NAME FOR FULL NAME: "${label}" => "${value}"`);
      }

      // 5. Date field with wrong format
      if (category === "disability_status" && /date/i.test(label)) {
        issues.push(`[#${r.id} ${r.company}] DATE FIELD MISCLASSIFIED: "${label}" => "${value}" (classified as disability_status)`);
      }

      // 6. Sanctions/territory question answered with country name
      if (/sanction|embargo|cuba|iran|north korea|crimea/i.test(label) && !/no|none|n\/a/i.test(value) && value.length > 0) {
        issues.push(`[#${r.id} ${r.company}] SANCTIONS Q WRONG ANSWER: "${label}" => "${value}"`);
      }

      // 7. Fields that failed to fill
      if (outcome === "failed" && f.required) {
        issues.push(`[#${r.id} ${r.company}] REQUIRED FIELD FAILED: "${label}" (${category}, src=${source})`);
      }

      // 8. AI answers that look like resume summaries in short fields
      if (source === "ai" && value.startsWith("I have") && value.length > 100 && !/describe|tell|explain|experience with/i.test(label)) {
        issues.push(`[#${r.id} ${r.company}] AI WROTE RESUME SUMMARY: "${label}" => "${value.substring(0, 80)}..."`);
      }

      // 9. "Preferred Name" categories getting mapped to first name
      if (/legal.*name/i.test(label) && category === "last_name") {
        issues.push(`[#${r.id} ${r.company}] LEGAL NAME => LAST NAME ONLY: "${label}" => "${value}"`);
      }
    }
  }

  console.log(`=== Submission Audit: ${data?.length ?? 0} jobs, ${totalFields} total fields, ${totalAi} AI-answered ===\n`);

  if (issues.length) {
    console.log(`FOUND ${issues.length} ISSUES:\n`);
    for (const issue of issues) {
      console.log(`  ⚠ ${issue}`);
    }
  } else {
    console.log("No issues detected in submitted jobs.");
  }
}

main().catch(console.error);
