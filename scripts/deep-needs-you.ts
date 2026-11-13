import { createClient } from "@supabase/supabase-js";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function main() {
  // 1. Get all profiles with autofill data
  const { data: profiles, error: profErr } = await sb
    .from("profiles")
    .select("id, full_name, autofill")
    .limit(10);

  if (profErr) { console.error("Profile error:", profErr.message); return; }

  console.log("=== PROFILES ===\n");
  for (const p of profiles ?? []) {
    console.log(`Profile #${p.id}: ${p.full_name}`);
    const af = p.autofill as Record<string, unknown> | null;
    if (af) {
      console.log("  Autofill fields:");
      for (const [k, v] of Object.entries(af).sort((a, b) => a[0].localeCompare(b[0]))) {
        if (v && String(v).trim()) {
          const val = String(v).trim();
          // Truncate long values
          console.log(`    ${k}: ${val.length > 200 ? val.substring(0, 200) + '...' : val}`);
        }
      }
      // Show which standard fields are MISSING
      const expected = [
        'pronouns', 'github', 'portfolio', 'currentTitle', 'currentCompany',
        'yearsOfExperience', 'desiredSalary', 'noticePeriod', 'howDidYouHear',
        'relocationPreference', 'highestEducation', 'degree', 'major',
        'gender', 'race', 'hispanicLatino', 'veteranStatus', 'disabilityStatus',
        'extraFacts', 'savedAnswers'
      ];
      const missing = expected.filter(k => !af[k] || !String(af[k]).trim());
      if (missing.length) {
        console.log(`  MISSING autofill fields: ${missing.join(', ')}`);
      }
    } else {
      console.log("  *** NO AUTOFILL DATA ***");
    }
    console.log();
  }

  // 2. Get needs_you jobs with full metadata
  const { data: needsYou, error: nyErr } = await sb
    .from("resume_db_applications")
    .select("id, company, job_title, ats_platform, bid_state, bid_error, bid_meta, job_link")
    .eq("bid_state", "needs_you")
    .order("id", { ascending: false })
    .limit(40);

  if (nyErr) { console.error("needs_you error:", nyErr.message); return; }

  console.log(`\n=== NEEDS_YOU JOBS — FIELD-LEVEL DETAIL (${needsYou?.length ?? 0}) ===\n`);

  // Group by failure type
  const byType: Record<string, typeof needsYou> = {};

  for (const r of needsYou ?? []) {
    const meta = r.bid_meta as Record<string, unknown> | null;
    const err = r.bid_error || "";

    let type = "other";
    if (/captcha/i.test(err)) type = "captcha";
    else if (/verification code/i.test(err)) type = "email_verification";
    else if (/no application form/i.test(err)) type = "no_form";
    else if (/no next button/i.test(err)) type = "workday_nav";
    else if (/no confirmation/i.test(err)) type = "no_confirmation";
    else if (/required field/i.test(err)) type = "unfilled_field";

    if (!byType[type]) byType[type] = [];
    byType[type]!.push(r);

    // Only print detail for non-CAPTCHA issues (CAPTCHA is a site problem, not autofill)
    if (type === "captcha") continue;

    console.log(`\n--- [#${r.id}] ${r.company} (${r.ats_platform}) ---`);
    console.log(`  Error: ${err.substring(0, 300)}`);

    // Extract open fields from bid_meta
    const openFields = Array.isArray(meta?.openFields) ? meta.openFields as Array<Record<string, unknown>> : [];
    const filledFields = Array.isArray(meta?.filledFields) ? meta.filledFields as Array<Record<string, unknown>> : [];
    const allFields = Array.isArray(meta?.allFields) ? meta.allFields as Array<Record<string, unknown>> : [];

    if (openFields.length) {
      console.log(`  UNFILLED fields (${openFields.length}):`);
      for (const f of openFields) {
        const label = f.questionText || f.labelText || f.label || f.fieldCategory || f.name || "?";
        const cat = f.fieldCategory || "?";
        const val = f.suggestedValue || f.value || "";
        const status = f.status || f.fillOutcome || "";
        const ftype = f.fieldType || f.inputType || "";
        const opts = Array.isArray(f.options) ? f.options.slice(0, 10).join(", ") : "";
        console.log(`    Field: "${label}"`);
        console.log(`      Category: ${cat}, Type: ${ftype}`);
        if (val) console.log(`      Value attempted: "${String(val).substring(0, 200)}"`);
        if (status) console.log(`      Status: ${status}`);
        if (opts) console.log(`      Options: [${opts}]`);
      }
    }

    if (filledFields.length) {
      console.log(`  FILLED fields (${filledFields.length}):`);
      for (const f of filledFields) {
        const label = f.questionText || f.labelText || f.label || f.fieldCategory || "?";
        const val = f.suggestedValue || f.value || "";
        const cat = f.fieldCategory || "?";
        console.log(`    "${label}" [${cat}] => "${String(val).substring(0, 150)}"`);
      }
    }

    if (allFields.length && !openFields.length && !filledFields.length) {
      console.log(`  ALL fields (${allFields.length}):`);
      for (const f of allFields) {
        const label = f.questionText || f.labelText || f.label || f.fieldCategory || "?";
        const val = f.suggestedValue || f.value || "";
        const cat = f.fieldCategory || "?";
        const outcome = f.fillOutcome || "";
        console.log(`    "${label}" [${cat}] => "${String(val).substring(0, 150)}" (${outcome})`);
      }
    }

    // Print steps for context
    const steps = Array.isArray(meta?.steps) ? meta.steps as Array<{ text: string; at: string }> : [];
    if (steps.length && !openFields.length && !filledFields.length && !allFields.length) {
      console.log("  Last 5 steps:");
      for (const s of steps.slice(-5)) {
        console.log(`    ${s.text?.substring(0, 200)}`);
      }
    }
  }

  // Print summary by type
  console.log("\n\n=== FAILURE SUMMARY ===");
  for (const [type, jobs] of Object.entries(byType).sort((a, b) => (b[1]?.length ?? 0) - (a[1]?.length ?? 0))) {
    console.log(`  ${type}: ${jobs?.length ?? 0} jobs`);
  }

  // 3. Get recently submitted jobs to see what was filled successfully
  const { data: submitted, error: subErr } = await sb
    .from("resume_db_applications")
    .select("id, company, job_title, ats_platform, bid_meta, job_link")
    .eq("bid_state", "submitted")
    .order("id", { ascending: false })
    .limit(5);

  if (subErr) { console.error("submitted error:", subErr.message); return; }

  console.log(`\n\n=== RECENTLY SUBMITTED — FIELD DATA (${submitted?.length ?? 0}) ===\n`);

  for (const r of submitted ?? []) {
    const meta = r.bid_meta as Record<string, unknown> | null;
    console.log(`\n--- [#${r.id}] ${r.company} (${r.ats_platform}) ---`);

    const filledFields = Array.isArray(meta?.filledFields) ? meta.filledFields as Array<Record<string, unknown>> : [];
    const allFields = Array.isArray(meta?.allFields) ? meta.allFields as Array<Record<string, unknown>> : [];
    const openFields = Array.isArray(meta?.openFields) ? meta.openFields as Array<Record<string, unknown>> : [];

    const fields = filledFields.length ? filledFields : allFields;
    if (fields.length) {
      console.log(`  Fields filled (${fields.length}):`);
      for (const f of fields) {
        const label = f.questionText || f.labelText || f.label || f.fieldCategory || "?";
        const val = f.suggestedValue || f.value || "";
        const cat = f.fieldCategory || "?";
        const source = f.source || "";
        const outcome = f.fillOutcome || "";
        console.log(`    "${String(label).substring(0, 80)}" [${cat}] => "${String(val).substring(0, 150)}" (${source} ${outcome})`);
      }
    } else {
      // Check for any field-level data in meta
      const steps = Array.isArray(meta?.steps) ? meta.steps as Array<{ text: string }> : [];
      console.log(`  No field-level data in bid_meta. Steps: ${steps.length}`);
      // Print last step to see if there's useful info
      if (steps.length) {
        console.log(`  Last step: ${steps[steps.length - 1]?.text?.substring(0, 200)}`);
      }
    }

    if (openFields.length) {
      console.log(`  STILL OPEN after submit (${openFields.length}):`);
      for (const f of openFields) {
        const label = f.questionText || f.labelText || f.label || f.fieldCategory || "?";
        console.log(`    "${label}"`);
      }
    }
  }
}

main().catch(console.error);
