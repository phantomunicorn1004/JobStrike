import { createClient } from "@supabase/supabase-js";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function main() {
  // Check the specific problematic jobs
  const ids = [2935, 2922, 2920, 2918, 2909, 2879, 2872, 2865];
  const { data, error } = await sb
    .from("resume_db_applications")
    .select("id, company, ats_platform, bid_fields")
    .in("id", ids)
    .order("id", { ascending: false });

  if (error) { console.error(error.message); return; }

  for (const r of data ?? []) {
    const fields = r.bid_fields as Array<Record<string, unknown>> | null;
    if (!fields) continue;
    console.log(`\n${"=".repeat(80)}`);
    console.log(`[#${r.id}] ${r.company} (${r.ats_platform})`);
    for (const f of fields) {
      const label = String(f.label || "?");
      const value = String(f.value || "");
      const source = String(f.source || "?");
      const outcome = String(f.outcome || "?");
      const category = String(f.category || "");
      const required = f.required ? "REQ" : "opt";
      const err = String(f.error || "");
      console.log(`  [${required}] ${category.padEnd(22)} src=${source.padEnd(14)} out=${outcome.padEnd(10)} "${label}"`);
      if (value) console.log(`       => "${value}"`);
      if (err) console.log(`       ERR: ${err}`);
    }
  }
}

main().catch(console.error);
