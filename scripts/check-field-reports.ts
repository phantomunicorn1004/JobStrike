import { createClient } from "@supabase/supabase-js";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function main() {
  // Check submitted jobs for fieldReport in bid_meta
  const { data: submitted, error } = await sb
    .from("resume_db_applications")
    .select("id, company, ats_platform, bid_meta, bid_fields")
    .eq("bid_state", "submitted")
    .order("id", { ascending: false })
    .limit(5);

  if (error) { console.error(error.message); return; }

  console.log("=== Field reports in SUBMITTED jobs ===\n");
  for (const r of submitted ?? []) {
    const report = r.bid_fields as Array<Record<string, unknown>> | null;
    console.log(`[#${r.id}] ${r.company} (${r.ats_platform})`);
    console.log(`  bid_fields present: ${report ? 'YES' : 'NO'}`);
    console.log(`  bid_fields length: ${report?.length ?? 0}`);
    if (report?.length) {
      for (const f of report) {
        const label = String(f.label || "?").padEnd(50);
        const source = String(f.source || "?").padEnd(12);
        const outcome = String(f.outcome || "?").padEnd(15);
        const cat = String(f.category || "").padEnd(20);
        const value = String(f.value || "");
        console.log(`    ${label} cat=${cat} src=${source} out=${outcome}`);
        if (value) console.log(`      => "${value}"`);
      }
    }
    console.log();
  }

  // Also check needs_you jobs
  const { data: needsYou } = await sb
    .from("resume_db_applications")
    .select("id, company, ats_platform, bid_meta, bid_fields")
    .eq("bid_state", "needs_you")
    .order("id", { ascending: false })
    .limit(3);

  console.log("\n=== Field reports in NEEDS_YOU jobs ===\n");
  for (const r of needsYou ?? []) {
    const report = r.bid_fields as Array<Record<string, unknown>> | null;
    console.log(`[#${r.id}] ${r.company} (${r.ats_platform})`);
    console.log(`  bid_fields present: ${report ? 'YES' : 'NO'}`);
    console.log(`  bid_fields length: ${report?.length ?? 0}`);
    if (report?.length) {
      for (const f of report) {
        const label = String(f.label || "?").padEnd(50);
        const source = String(f.source || "?").padEnd(12);
        const outcome = String(f.outcome || "?").padEnd(15);
        const cat = String(f.category || "").padEnd(20);
        const value = String(f.value || "");
        console.log(`    ${label} cat=${cat} src=${source} out=${outcome}`);
        if (value) console.log(`      => "${value}"`);
      }
    }
    console.log();
  }
}

main().catch(console.error);
