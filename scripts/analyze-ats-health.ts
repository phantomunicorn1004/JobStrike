import { createClient } from "@supabase/supabase-js";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function main() {
  // Get recent rows with bid activity (last ~200 rows that have a bid_state)
  const { data: rows, error } = await sb
    .from("resume_db_applications")
    .select("id, company, job_title, ats_platform, generation_status, bid_state, bid_error, bid_meta, applied_at, created_at")
    .not("bid_state", "is", null)
    .not("bid_state", "eq", "none")
    .order("id", { ascending: false })
    .limit(200);

  if (error) {
    console.error("Query error:", error.message);
    return;
  }

  console.log(`=== ATS Health Report (last ${rows?.length} bid attempts) ===\n`);

  // Group by ATS
  const byAts: Record<string, { sent: any[], failed: any[], needsYou: any[], bidding: any[], expired: any[] }> = {};

  for (const r of rows ?? []) {
    const ats = r.ats_platform || "unknown";
    if (!byAts[ats]) byAts[ats] = { sent: [], failed: [], needsYou: [], bidding: [], expired: [] };

    if (r.bid_state === "submitted") byAts[ats].sent.push(r);
    else if (r.bid_state === "failed") byAts[ats].failed.push(r);
    else if (r.bid_state === "needs_you") byAts[ats].needsYou.push(r);
    else if (r.bid_state === "bidding") byAts[ats].bidding.push(r);
    else if (r.bid_state === "expired") byAts[ats].expired.push(r);
  }

  // Print summary table
  console.log("ATS".padEnd(22) + "Sent".padEnd(8) + "Failed".padEnd(8) + "NeedsYou".padEnd(10) + "Bidding".padEnd(9) + "Expired".padEnd(9) + "Total".padEnd(7) + "Success%");
  console.log("-".repeat(80));

  const sorted = Object.entries(byAts).sort((a, b) => {
    const totalA = a[1].sent.length + a[1].failed.length + a[1].needsYou.length + a[1].bidding.length + a[1].expired.length;
    const totalB = b[1].sent.length + b[1].failed.length + b[1].needsYou.length + b[1].bidding.length + b[1].expired.length;
    return totalB - totalA;
  });

  for (const [ats, data] of sorted) {
    const total = data.sent.length + data.failed.length + data.needsYou.length + data.bidding.length + data.expired.length;
    const rate = total > 0 ? Math.round((data.sent.length / total) * 100) : 0;
    console.log(
      ats.padEnd(22) +
      String(data.sent.length).padEnd(8) +
      String(data.failed.length).padEnd(8) +
      String(data.needsYou.length).padEnd(10) +
      String(data.bidding.length).padEnd(9) +
      String(data.expired.length).padEnd(9) +
      String(total).padEnd(7) +
      `${rate}%`
    );
  }

  // Show details for failed and needs_you rows grouped by ATS
  for (const [ats, data] of sorted) {
    const problems = [...data.failed, ...data.needsYou];
    if (problems.length === 0) continue;

    console.log(`\n=== ${ats} — Issues (${problems.length}) ===`);
    for (const r of problems) {
      const errShort = (r.bid_error || "").substring(0, 200);
      const meta = r.bid_meta as any;
      const reason = meta?.failReason || meta?.stoppedReason || "";
      const detail = meta?.failDetail || meta?.stoppedDetail || "";
      const lastStep = meta?.lastStep || "";
      console.log(`  #${r.id} [${r.bid_state}] ${r.company} — ${r.job_title}`);
      if (errShort) console.log(`    Error: ${errShort}`);
      if (reason) console.log(`    Reason: ${reason}`);
      if (detail) console.log(`    Detail: ${String(detail).substring(0, 200)}`);
      if (lastStep) console.log(`    Last step: ${lastStep}`);
    }
  }

  // Specifically check Workday and iCIMS
  console.log("\n=== Workday Detail ===");
  const workday = (rows ?? []).filter(r => (r.ats_platform || "").toLowerCase() === "workday");
  if (workday.length === 0) {
    console.log("  No Workday bid attempts in recent rows");
  } else {
    for (const r of workday) {
      console.log(`  #${r.id} [${r.bid_state}] ${r.company} — ${r.job_title} — ${r.bid_error || "OK"}`);
    }
  }

  console.log("\n=== iCIMS Detail ===");
  const icims = (rows ?? []).filter(r => (r.ats_platform || "").toLowerCase().includes("icims"));
  if (icims.length === 0) {
    console.log("  No iCIMS bid attempts in recent rows");
  } else {
    for (const r of icims) {
      console.log(`  #${r.id} [${r.bid_state}] ${r.company} — ${r.job_title} — ${r.bid_error || "OK"}`);
    }
  }
}

main().catch(console.error);
