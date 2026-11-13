import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  // 1. Overall bid state distribution
  const { data: all } = await sb
    .from("resume_db_applications")
    .select("id, bid_state, ats_platform, bid_error, bid_meta, applied_at, posted_at, created_at")
    .neq("bid_state", "none")
    .order("id", { ascending: false })
    .limit(500);

  if (!all?.length) { console.log("No bid data found."); return; }

  console.log(`\n${"=".repeat(70)}`);
  console.log("  AUTO-BID RESULTS ANALYSIS");
  console.log(`${"=".repeat(70)}\n`);

  // Overall counts
  const byState: Record<string, number> = {};
  for (const r of all) byState[r.bid_state] = (byState[r.bid_state] || 0) + 1;
  const total = all.length;

  console.log("--- OVERALL OUTCOMES ---\n");
  for (const [state, count] of Object.entries(byState).sort((a, b) => b[1] - a[1])) {
    const pct = ((count / total) * 100).toFixed(1);
    const bar = "█".repeat(Math.round(count / total * 40));
    console.log(`  ${state.padEnd(14)} ${String(count).padStart(4)}  (${pct.padStart(5)}%)  ${bar}`);
  }
  console.log(`  ${"TOTAL".padEnd(14)} ${String(total).padStart(4)}`);

  // 2. By ATS platform
  console.log("\n--- BY ATS PLATFORM ---\n");
  const byAts: Record<string, Record<string, number>> = {};
  for (const r of all) {
    const ats = r.ats_platform || "unknown";
    if (!byAts[ats]) byAts[ats] = {};
    byAts[ats][r.bid_state] = (byAts[ats][r.bid_state] || 0) + 1;
  }

  const atsRows = Object.entries(byAts).map(([ats, states]) => {
    const t = Object.values(states).reduce((s, n) => s + n, 0);
    const submitted = states.submitted || 0;
    const rate = t > 0 ? ((submitted / t) * 100).toFixed(0) : "0";
    return { ats, total: t, submitted, needsYou: states.needs_you || 0, failed: states.failed || 0, expired: states.expired || 0, rate };
  }).sort((a, b) => b.total - a.total);

  console.log(`  ${"Platform".padEnd(20)} ${"Total".padStart(5)} ${"Submit".padStart(6)} ${"NeedU".padStart(6)} ${"Fail".padStart(5)} ${"Expir".padStart(5)} ${"Rate".padStart(6)}`);
  console.log(`  ${"-".repeat(59)}`);
  for (const r of atsRows) {
    console.log(`  ${r.ats.padEnd(20)} ${String(r.total).padStart(5)} ${String(r.submitted).padStart(6)} ${String(r.needsYou).padStart(6)} ${String(r.failed).padStart(5)} ${String(r.expired).padStart(5)} ${(r.rate + "%").padStart(6)}`);
  }

  // 3. Needs_you reason breakdown
  console.log("\n--- NEEDS_YOU REASONS ---\n");
  const needsYouJobs = all.filter(r => r.bid_state === "needs_you");
  const reasonCounts: Record<string, number> = {};
  for (const r of needsYouJobs) {
    const reason = classifyReason(r.bid_error || "");
    reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
  }
  for (const [reason, count] of Object.entries(reasonCounts).sort((a, b) => b[1] - a[1])) {
    const pct = ((count / needsYouJobs.length) * 100).toFixed(0);
    console.log(`  ${reason.padEnd(20)} ${String(count).padStart(4)}  (${pct}%)`);
  }

  // 4. Failed reason breakdown
  console.log("\n--- FAILED REASONS (top patterns) ---\n");
  const failedJobs = all.filter(r => r.bid_state === "failed");
  const failReasons: Record<string, number> = {};
  for (const r of failedJobs) {
    const reason = classifyFailReason(r.bid_error || "");
    failReasons[reason] = (failReasons[reason] || 0) + 1;
  }
  for (const [reason, count] of Object.entries(failReasons).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${reason.padEnd(30)} ${String(count).padStart(4)}`);
  }

  // 5. Success rate over time (by week)
  console.log("\n--- SUCCESS RATE BY WEEK ---\n");
  const submitted = all.filter(r => r.bid_state === "submitted" && r.applied_at);
  const byWeek: Record<string, { submitted: number; total: number }> = {};
  for (const r of all) {
    const date = r.applied_at || r.created_at || "";
    if (!date) continue;
    const d = new Date(date);
    const weekStart = new Date(d);
    weekStart.setDate(d.getDate() - d.getDay());
    const key = weekStart.toISOString().substring(0, 10);
    if (!byWeek[key]) byWeek[key] = { submitted: 0, total: 0 };
    byWeek[key].total++;
    if (r.bid_state === "submitted") byWeek[key].submitted++;
  }
  const weeks = Object.entries(byWeek).sort((a, b) => a[0].localeCompare(b[0]));
  console.log(`  ${"Week of".padEnd(14)} ${"Total".padStart(5)} ${"Sent".padStart(5)} ${"Rate".padStart(6)}`);
  for (const [week, data] of weeks) {
    const rate = data.total > 0 ? ((data.submitted / data.total) * 100).toFixed(0) : "0";
    const bar = "█".repeat(Math.round(data.submitted / Math.max(...weeks.map(w => w[1].submitted || 1)) * 20));
    console.log(`  ${week.padEnd(14)} ${String(data.total).padStart(5)} ${String(data.submitted).padStart(5)} ${(rate + "%").padStart(6)}  ${bar}`);
  }

  // 6. Field accuracy stats (from bid_fields)
  console.log("\n--- FIELD ACCURACY (submitted jobs with bid_fields) ---\n");
  const { data: fieldJobs } = await sb
    .from("resume_db_applications")
    .select("id, bid_fields")
    .eq("bid_state", "submitted")
    .not("bid_fields", "is", null)
    .order("id", { ascending: false })
    .limit(100);

  let totalFields = 0, filledFields = 0, failedFields = 0, aiFields = 0, profileFields = 0;
  for (const r of fieldJobs || []) {
    const fields = r.bid_fields as Array<Record<string, unknown>> | null;
    if (!fields) continue;
    for (const f of fields) {
      totalFields++;
      if (f.outcome === "filled") filledFields++;
      if (f.outcome === "failed") failedFields++;
      if (f.source === "ai") aiFields++;
      if (f.source === "profile") profileFields++;
    }
  }
  const fillRate = totalFields > 0 ? ((filledFields / totalFields) * 100).toFixed(1) : "0";
  console.log(`  Jobs with field data:  ${fieldJobs?.length || 0}`);
  console.log(`  Total fields:          ${totalFields}`);
  console.log(`  Filled successfully:   ${filledFields} (${fillRate}%)`);
  console.log(`  Failed to fill:        ${failedFields}`);
  console.log(`  Source — profile:      ${profileFields}`);
  console.log(`  Source — AI:           ${aiFields}`);

  // 7. Average time from queue to submit
  console.log("\n--- SPEED ---\n");
  const times: number[] = [];
  for (const r of submitted) {
    if (r.applied_at && r.created_at) {
      const diff = (new Date(r.applied_at).getTime() - new Date(r.created_at).getTime()) / (1000 * 60 * 60);
      if (diff > 0 && diff < 168) times.push(diff);
    }
  }
  if (times.length) {
    times.sort((a, b) => a - b);
    const avg = times.reduce((s, t) => s + t, 0) / times.length;
    const median = times[Math.floor(times.length / 2)];
    console.log(`  Queue → Submit (${times.length} jobs):`);
    console.log(`    Average:  ${avg.toFixed(1)} hours`);
    console.log(`    Median:   ${median.toFixed(1)} hours`);
    console.log(`    Fastest:  ${times[0].toFixed(1)} hours`);
    console.log(`    Slowest:  ${times[times.length - 1].toFixed(1)} hours`);
  }

  console.log(`\n${"=".repeat(70)}\n`);
}

function classifyReason(err: string): string {
  const d = err.toLowerCase();
  if (/captcha/i.test(d)) return "CAPTCHA";
  if (/verification code/i.test(d)) return "Verification code";
  if (/in my own words|own words/i.test(d)) return "Own words required";
  if (/not filled|needs your input|not enough facts/i.test(d)) return "Missing field";
  if (/sign.?in|log.?in|login|password/i.test(d)) return "Login wall";
  if (/no application form/i.test(d)) return "No form found";
  if (/no submit button|auto-submit does not cover|submit it by hand/i.test(d)) return "Manual submit";
  if (/refused.*spam|possible spam|real human/i.test(d)) return "Spam block";
  if (/error|rejected|could not advance/i.test(d)) return "Form error";
  if (/dry run/i.test(d)) return "Dry run";
  return "Other";
}

function classifyFailReason(err: string): string {
  const d = err.toLowerCase();
  if (/no application form/i.test(d)) return "No form found";
  if (/timeout|timed out/i.test(d)) return "Timeout";
  if (/could not fill|fill.*failed/i.test(d)) return "Fill failed";
  if (/not on a supported|does not cover/i.test(d)) return "Unsupported site";
  if (/navigation|navigate/i.test(d)) return "Navigation error";
  if (/error|exception|crash/i.test(d)) return "Runtime error";
  if (/closed|removed|expired/i.test(d)) return "Job closed";
  if (/duplicate|already applied/i.test(d)) return "Already applied";
  if (/blocked|denied|forbidden/i.test(d)) return "Blocked";
  if (d.length < 5) return "Unknown";
  return "Other: " + err.substring(0, 60);
}

main().catch(console.error);
