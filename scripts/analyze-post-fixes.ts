import { createClient } from "@supabase/supabase-js";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function main() {
  // Latest push: Nov 13 05:44 UTC
  const cutoff = "2026-11-13T05:44:00Z";

  const { data: rows, error } = await sb
    .from("resume_db_applications")
    .select("id, profile_id, company, job_title, ats_platform, generation_status, generation_error, generation_meta, bid_state, bid_error, bid_meta, applied_at, created_at, resume_drive_file_id, built_resume_json")
    .or(`applied_at.gte.${cutoff},created_at.gte.${cutoff}`)
    .order("id", { ascending: false })
    .limit(300);

  if (error) {
    console.error("Query error:", error.message);
    return;
  }

  console.log(`=== Auto-bid activity after fixes push (${cutoff}) ===`);
  console.log(`Total rows: ${rows?.length ?? 0}\n`);

  // Stats
  const stats: Record<string, number> = {};
  const byAts: Record<string, { sent: any[], failed: any[], needsYou: any[], bidding: any[], expired: any[], none: any[] }> = {};
  const issues: any[] = [];

  for (const r of rows ?? []) {
    const ats = r.ats_platform || "unknown";
    if (!byAts[ats]) byAts[ats] = { sent: [], failed: [], needsYou: [], bidding: [], expired: [], none: [] };

    const bid = r.bid_state || "none";
    if (bid === "submitted") byAts[ats].sent.push(r);
    else if (bid === "failed") byAts[ats].failed.push(r);
    else if (bid === "needs_you") byAts[ats].needsYou.push(r);
    else if (bid === "bidding") byAts[ats].bidding.push(r);
    else if (bid === "expired") byAts[ats].expired.push(r);
    else byAts[ats].none.push(r);

    stats[bid] = (stats[bid] || 0) + 1;

    if (bid === "needs_you" || bid === "failed") {
      issues.push({
        id: r.id, type: bid, company: r.company, ats, error: r.bid_error,
        meta: r.bid_meta, gen: r.generation_status,
      });
    }

    // Check placeholder contamination
    if (r.built_resume_json && /\bExtracted Company\b|\[JD[\s\w]*\]/i.test(r.built_resume_json)) {
      issues.push({ id: r.id, type: "PLACEHOLDER_JSON", company: r.company, ats });
    }
  }

  // Overall stats
  console.log("--- Overall ---");
  for (const [k, v] of Object.entries(stats).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(14)} ${v}`);
  }
  const total = rows?.length ?? 0;
  const sent = stats["submitted"] || 0;
  console.log(`  Success rate: ${total ? Math.round((sent / total) * 100) : 0}% (${sent}/${total})\n`);

  // Per-ATS table
  console.log("ATS".padEnd(22) + "Sent".padEnd(7) + "Fail".padEnd(7) + "NeedU".padEnd(7) + "Biddng".padEnd(7) + "Exprd".padEnd(7) + "None".padEnd(7) + "Total".padEnd(7) + "Rate");
  console.log("-".repeat(78));
  const sorted = Object.entries(byAts).sort((a, b) => {
    const ta = Object.values(a[1]).reduce((s, arr) => s + arr.length, 0);
    const tb = Object.values(b[1]).reduce((s, arr) => s + arr.length, 0);
    return tb - ta;
  });
  for (const [ats, d] of sorted) {
    const t = d.sent.length + d.failed.length + d.needsYou.length + d.bidding.length + d.expired.length + d.none.length;
    const attempted = d.sent.length + d.failed.length + d.needsYou.length;
    const rate = attempted ? Math.round((d.sent.length / attempted) * 100) : "-";
    console.log(
      ats.padEnd(22) + String(d.sent.length).padEnd(7) + String(d.failed.length).padEnd(7) +
      String(d.needsYou.length).padEnd(7) + String(d.bidding.length).padEnd(7) +
      String(d.expired.length).padEnd(7) + String(d.none.length).padEnd(7) +
      String(t).padEnd(7) + `${rate}%`
    );
  }

  // Issues detail
  console.log(`\n--- Issues (${issues.length}) ---`);
  for (const issue of issues) {
    console.log(`\n[#${issue.id}] ${issue.type} - ${issue.company ?? "?"} (${issue.ats})`);
    if (issue.error) console.log(`  Error: ${(issue.error as string).substring(0, 300)}`);
    if (issue.meta) {
      const m = issue.meta as any;
      if (m.failReason) console.log(`  Fail reason: ${m.failReason}`);
      if (m.stoppedReason) console.log(`  Stopped reason: ${m.stoppedReason}`);
      if (m.lastStep) console.log(`  Last step: ${m.lastStep}`);
    }
  }

  // Compare with pre-fix: check Ashby CAPTCHA rate
  const ashbyAttempted = (byAts["Ashby"]?.sent.length || 0) + (byAts["Ashby"]?.needsYou.length || 0) + (byAts["Ashby"]?.failed.length || 0);
  const ashbyCaptcha = (byAts["Ashby"]?.needsYou || []).filter((r: any) => /captcha/i.test(r.bid_error || "")).length;
  console.log(`\n--- Ashby CAPTCHA check ---`);
  console.log(`  Attempted: ${ashbyAttempted}, CAPTCHA: ${ashbyCaptcha}, Sent: ${byAts["Ashby"]?.sent.length || 0}`);
  console.log(`  Pre-fix: 15/15 CAPTCHA (100%), Post-fix: ${ashbyAttempted ? ashbyCaptcha + "/" + ashbyAttempted : "no data yet"}`);

  // Check Workday/SmartRecruiters/Pinpoint/Workable specifically
  for (const ats of ["Workday", "SmartRecruiters", "Pinpoint", "Workable"]) {
    const d = byAts[ats];
    if (!d) continue;
    const all = [...d.sent, ...d.failed, ...d.needsYou, ...d.bidding, ...d.expired, ...d.none];
    if (!all.length) continue;
    console.log(`\n--- ${ats} detail ---`);
    for (const r of all) {
      const bid = (r.bid_state || "none").padEnd(12);
      const err = (r.bid_error || "").substring(0, 120);
      console.log(`  #${String(r.id).padEnd(5)} ${(r.company ?? "?").padEnd(25)} bid=${bid} ${err}`);
    }
  }
}

main().catch(console.error);
