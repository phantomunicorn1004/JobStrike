import { createClient } from "@supabase/supabase-js";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function main() {
  const { data, error } = await sb
    .from("resume_db_applications")
    .select("id, company, ats_platform, generation_status, bid_state, apply, job_link, created_at, posted_at")
    .in("ats_platform", ["SmartRecruiters", "Workday", "iCIMS", "Pinpoint", "Rippling"])
    .order("id", { ascending: false })
    .limit(30);

  if (error) {
    console.error(error.message);
    return;
  }

  console.log(
    "Platform".padEnd(18) +
    "GenStat".padEnd(14) +
    "BidState".padEnd(12) +
    "Apply".padEnd(10) +
    "Company".padEnd(28) +
    "JobLink(host)"
  );
  console.log("-".repeat(110));

  for (const r of data ?? []) {
    let host = "";
    try { host = new URL(r.job_link || "").hostname; } catch {}
    console.log(
      (r.ats_platform || "?").padEnd(18) +
      (r.generation_status || "none").padEnd(14) +
      (r.bid_state || "none").padEnd(12) +
      (r.apply || "?").padEnd(10) +
      (r.company || "?").substring(0, 26).padEnd(28) +
      host
    );
  }
}

main().catch(console.error);
