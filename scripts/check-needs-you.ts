import { createClient } from "@supabase/supabase-js";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function main() {
  const { data, error } = await sb
    .from("resume_db_applications")
    .select("id, company, job_title, ats_platform, bid_state, bid_error, bid_meta, job_link")
    .eq("bid_state", "needs_you")
    .order("id", { ascending: false })
    .limit(40);

  if (error) {
    console.error(error.message);
    return;
  }

  console.log(`=== needs_you jobs (${data?.length ?? 0}) ===\n`);

  for (const r of data ?? []) {
    const meta = r.bid_meta as Record<string, unknown> | null;
    const steps = Array.isArray(meta?.steps) ? meta.steps as Array<{ text: string; at: string }> : [];
    const openFields = Array.isArray(meta?.openFields) ? meta.openFields as Array<Record<string, string>> : [];

    console.log(`\n${"=".repeat(80)}`);
    console.log(`[#${r.id}] ${r.company} — ${r.job_title}`);
    console.log(`  ATS: ${r.ats_platform}`);
    console.log(`  Error: ${r.bid_error || "(none)"}`);

    if (meta?.failReason) console.log(`  Fail reason: ${meta.failReason}`);
    if (meta?.stoppedReason) console.log(`  Stopped reason: ${meta.stoppedReason}`);
    if (meta?.lastStep) console.log(`  Last step: ${meta.lastStep}`);
    if (meta?.step) console.log(`  Current step: ${meta.step}`);

    if (openFields.length) {
      console.log(`\n  Open fields (${openFields.length}):`);
      for (const f of openFields) {
        const label = f.label || f.questionText || f.labelText || f.fieldCategory || "?";
        const val = f.value || f.suggestedValue || "";
        const status = f.status || f.fillOutcome || "";
        console.log(`    - "${label}" => "${val}" [${status}]`);
      }
    }

    if (steps.length) {
      console.log(`\n  Steps (last 10):`);
      for (const s of steps.slice(-10)) {
        console.log(`    ${s.at?.substring(11, 19) || "?"} ${s.text?.substring(0, 120) || "?"}`);
      }
    }
  }
}

main().catch(console.error);
