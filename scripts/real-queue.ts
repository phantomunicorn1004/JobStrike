import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const ON_AUTOBID_SITE = "job_link.ilike.*.greenhouse.io/*,job_link.ilike.*.lever.co/*,job_link.ilike.*.ashbyhq.com/*,job_link.ilike.*.rippling.com/*,job_link.ilike.*.workable.com/*,job_link.ilike.*.bamboohr.com/*,job_link.ilike.*.smartrecruiters.com/*,job_link.ilike.*.pinpointhq.com/*,job_link.ilike.*.myworkdayjobs.com/*,job_link.ilike.*.myworkdaysite.com/*,job_link.ilike.*.icims.com/*";

async function main() {
  const { data } = await sb
    .from("resume_db_applications")
    .select("id, company, ats_platform, bid_state, posted_at, job_link")
    .eq("generation_status", "completed")
    .eq("apply", "Queued")
    .eq("bid_state", "none")
    .or(ON_AUTOBID_SITE)
    .order("posted_at", { ascending: true, nullsFirst: false })
    .order("id", { ascending: true })
    .limit(40);

  console.log("=== REAL CLAIM QUEUE (with ON_AUTOBID_SITE filter) ===\n");
  let pos = 0;
  const byAts: Record<string, number> = {};
  for (const r of data || []) {
    pos++;
    const ats = r.ats_platform || "?";
    byAts[ats] = (byAts[ats] || 0) + 1;
    const host = r.job_link ? new URL(r.job_link).hostname : "?";
    console.log(`  #${String(pos).padStart(2)} [id=${r.id}] ${ats.padEnd(18)} ${host.padEnd(35)} posted=${(r.posted_at || "?").substring(0, 10)}`);
  }
  console.log(`\nTotal claimable: ${data?.length || 0}`);
  console.log("\nBy ATS:");
  for (const [ats, n] of Object.entries(byAts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${ats.padEnd(18)} ${n}`);
  }
}
main().catch(console.error);
