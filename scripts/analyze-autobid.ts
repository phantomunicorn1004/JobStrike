import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(url, key);

async function main() {
  // 1. Overall pipeline stats (last 7 days)
  console.log("=== PIPELINE OVERVIEW (last 7 days) ===\n");

  const cutoff = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();

  const { data: all } = await supabase
    .from("resume_db_applications")
    .select("id, profile_id, company, job_title, created_at, generation_status, generation_error, generation_meta, bid_state, bid_error, bid_meta, apply")
    .gte("created_at", cutoff)
    .order("created_at", { ascending: false })
    .limit(500);

  if (!all?.length) {
    console.log("No applications in the last 7 days.");
    return;
  }

  console.log(`Total applications: ${all.length}\n`);

  // Generation status breakdown
  const genCounts: Record<string, number> = {};
  for (const r of all) {
    const s = r.generation_status || "unknown";
    genCounts[s] = (genCounts[s] || 0) + 1;
  }
  console.log("Generation status:");
  for (const [k, v] of Object.entries(genCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k}: ${v} (${((v / all.length) * 100).toFixed(1)}%)`);
  }

  // Bid state breakdown
  const bidCounts: Record<string, number> = {};
  for (const r of all) {
    const s = r.bid_state || "none";
    bidCounts[s] = (bidCounts[s] || 0) + 1;
  }
  console.log("\nBid state:");
  for (const [k, v] of Object.entries(bidCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k}: ${v} (${((v / all.length) * 100).toFixed(1)}%)`);
  }

  // Apply status breakdown
  const applyCounts: Record<string, number> = {};
  for (const r of all) {
    const s = r.apply || "unknown";
    applyCounts[s] = (applyCounts[s] || 0) + 1;
  }
  console.log("\nApply status:");
  for (const [k, v] of Object.entries(applyCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k}: ${v} (${((v / all.length) * 100).toFixed(1)}%)`);
  }

  // Profile breakdown
  const profileCounts: Record<string, number> = {};
  for (const r of all) {
    profileCounts[r.profile_id || "null"] = (profileCounts[r.profile_id || "null"] || 0) + 1;
  }
  console.log("\nBy profile:");
  for (const [k, v] of Object.entries(profileCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  profile_id=${k}: ${v}`);
  }

  // 2. Generation failures
  console.log("\n\n=== GENERATION FAILURES ===\n");
  const genFailed = all.filter((r) => r.generation_status === "failed");
  if (genFailed.length) {
    const errorCounts: Record<string, number> = {};
    for (const r of genFailed) {
      const err = String(r.generation_error || "unknown").slice(0, 120);
      errorCounts[err] = (errorCounts[err] || 0) + 1;
    }
    console.log(`Total gen failures: ${genFailed.length}`);
    console.log("Error breakdown:");
    for (const [k, v] of Object.entries(errorCounts).sort((a, b) => b[1] - a[1])) {
      console.log(`  [${v}x] ${k}`);
    }
  } else {
    console.log("No generation failures.");
  }

  // 3. Bid failures / needs_you
  console.log("\n\n=== BID ISSUES ===\n");
  const bidIssues = all.filter((r) => r.bid_state === "needs_you" || r.bid_state === "failed");
  if (bidIssues.length) {
    console.log(`Total bid issues: ${bidIssues.length} (needs_you: ${bidIssues.filter(r => r.bid_state === "needs_you").length}, failed: ${bidIssues.filter(r => r.bid_state === "failed").length})`);
    console.log("\nDetails:");
    for (const r of bidIssues.slice(0, 20)) {
      const meta = r.bid_meta || {};
      console.log(`  #${r.id} ${r.company} — ${r.bid_state}: ${r.bid_error || "(no error)"}`);
      if (meta.step) console.log(`    last step: ${meta.step}`);
      if (meta.submitClicked) console.log(`    submitClicked: true`);
      if (meta.method) console.log(`    method: ${meta.method}`);
    }
  } else {
    console.log("No bid issues.");
  }

  // 4. Successfully submitted
  console.log("\n\n=== SUBMITTED APPLICATIONS ===\n");
  const submitted = all.filter((r) => r.bid_state === "submitted");
  console.log(`Total submitted: ${submitted.length}`);
  const registered = all.filter((r) => r.apply === "Registered");
  console.log(`Registered in Resume DB: ${registered.length}`);
  if (submitted.length) {
    console.log("\nRecent submitted:");
    for (const r of submitted.slice(0, 15)) {
      const meta = r.bid_meta || {};
      console.log(`  #${r.id} ${r.company} — "${r.job_title}" (${new Date(r.created_at).toLocaleDateString()})`);
      console.log(`    profile=${r.profile_id}, registered=${r.apply === "Registered"}, method=${meta.method || "?"}, submitClicked=${meta.submitClicked ?? "?"}`);
    }
  }

  // 5. Generation attempt counts
  console.log("\n\n=== GENERATION ATTEMPTS ===\n");
  const attemptCounts: Record<number, number> = {};
  for (const r of all) {
    const attempt = (r.generation_meta as any)?.attempt || 0;
    attemptCounts[attempt] = (attemptCounts[attempt] || 0) + 1;
  }
  console.log("Attempts distribution:");
  for (const [k, v] of Object.entries(attemptCounts).sort((a, b) => Number(a[0]) - Number(b[0]))) {
    console.log(`  attempt ${k}: ${v} apps`);
  }

  // 6. Time analysis
  console.log("\n\n=== TIMING ANALYSIS ===\n");
  const withTiming = all.filter((r) => {
    const gm = r.generation_meta as any;
    return gm?.completedAt;
  });
  if (withTiming.length) {
    const genTimes = withTiming.map((r) => {
      const created = new Date(r.created_at).getTime();
      const completed = new Date((r.generation_meta as any).completedAt).getTime();
      return (completed - created) / 1000;
    }).filter(t => t > 0 && t < 3600);
    if (genTimes.length) {
      genTimes.sort((a, b) => a - b);
      console.log(`Generation time (queue → complete):`);
      console.log(`  median: ${genTimes[Math.floor(genTimes.length / 2)].toFixed(0)}s`);
      console.log(`  p90: ${genTimes[Math.floor(genTimes.length * 0.9)].toFixed(0)}s`);
      console.log(`  max: ${genTimes[genTimes.length - 1].toFixed(0)}s`);
      console.log(`  min: ${genTimes[0].toFixed(0)}s`);
    }
  }

  // Bid timing
  const bidTimed = submitted.filter((r) => {
    const bm = r.bid_meta as any;
    return bm?.startedAt && bm?.finishedAt;
  });
  if (bidTimed.length) {
    const bidTimes = bidTimed.map((r) => {
      const bm = r.bid_meta as any;
      return (new Date(bm.finishedAt).getTime() - new Date(bm.startedAt).getTime()) / 1000;
    }).filter(t => t > 0 && t < 3600);
    if (bidTimes.length) {
      bidTimes.sort((a, b) => a - b);
      console.log(`\nBid time (start → finish):`);
      console.log(`  median: ${bidTimes[Math.floor(bidTimes.length / 2)].toFixed(0)}s`);
      console.log(`  p90: ${bidTimes[Math.floor(bidTimes.length * 0.9)].toFixed(0)}s`);
      console.log(`  max: ${bidTimes[bidTimes.length - 1].toFixed(0)}s`);
    }
  }

  // 7. Daily breakdown
  console.log("\n\n=== DAILY BREAKDOWN ===\n");
  const byDay: Record<string, { total: number; genOk: number; genFail: number; submitted: number; needsYou: number; bidFail: number; registered: number }> = {};
  for (const r of all) {
    const day = r.created_at.slice(0, 10);
    if (!byDay[day]) byDay[day] = { total: 0, genOk: 0, genFail: 0, submitted: 0, needsYou: 0, bidFail: 0, registered: 0 };
    byDay[day].total += 1;
    if (r.generation_status === "completed") byDay[day].genOk += 1;
    if (r.generation_status === "failed") byDay[day].genFail += 1;
    if (r.bid_state === "submitted") byDay[day].submitted += 1;
    if (r.bid_state === "needs_you") byDay[day].needsYou += 1;
    if (r.bid_state === "failed") byDay[day].bidFail += 1;
    if (r.apply === "Registered") byDay[day].registered += 1;
  }
  console.log("Date       | Total | GenOK | GenFail | Submitted | NeedsYou | BidFail | Registered");
  console.log("-".repeat(90));
  for (const [day, s] of Object.entries(byDay).sort()) {
    console.log(`${day} | ${String(s.total).padStart(5)} | ${String(s.genOk).padStart(5)} | ${String(s.genFail).padStart(7)} | ${String(s.submitted).padStart(9)} | ${String(s.needsYou).padStart(8)} | ${String(s.bidFail).padStart(7)} | ${String(s.registered).padStart(10)}`);
  }

  // 8. Check for suspect resumes (fabricated companies, placeholder text, etc.)
  console.log("\n\n=== RESUME QUALITY CHECK ===\n");
  const completedWithResume = all.filter((r) => r.generation_status === "completed");
  // Query their built_resume_json
  const { data: resumes } = await supabase
    .from("resume_db_applications")
    .select("id, company, profile_id, built_resume_json")
    .in("id", completedWithResume.map((r) => r.id));

  if (resumes?.length) {
    let placeholderIssues = 0;
    let emptySkills = 0;
    let emptyWorkArrangement = 0;
    const issues: string[] = [];

    for (const r of resumes) {
      if (!r.built_resume_json) continue;
      const raw = r.built_resume_json;
      const json = JSON.parse(raw);

      // Check for "Extracted Company" or other placeholder text
      if (/Extracted Company|\[JD[\s\w]*\]|City,\s*ST/i.test(raw)) {
        placeholderIssues++;
        issues.push(`  #${r.id} ${r.company}: Contains placeholder text`);
      }

      // Check for instruction text leak
      if (/replace each instruction|template completion task|STEP \d|JD ANALYSIS/i.test(raw)) {
        issues.push(`  #${r.id} ${r.company}: Contains prompt instruction leak`);
      }

      // Check skills
      const tech = json.technology_stack || json.skills;
      if (!tech) {
        emptySkills++;
      } else {
        const hasContent = Object.keys(tech).some((k) => {
          const v = tech[k];
          const t = typeof v === "object" && v !== null ? v.text : v;
          return t && String(t).trim().length > 0;
        });
        if (!hasContent) emptySkills++;
      }

      // Check work arrangement
      const work = json.work_experience || {};
      for (const ek of Object.keys(work).filter((k) => k.startsWith("experience_"))) {
        const role = work[ek];
        if (role?.work_arrangement) {
          const wat = typeof role.work_arrangement === "object" ? role.work_arrangement.text : role.work_arrangement;
          if (!wat || !String(wat).trim()) emptyWorkArrangement++;
        }
      }
    }

    console.log(`Resumes checked: ${resumes.length}`);
    console.log(`Placeholder text issues: ${placeholderIssues}`);
    console.log(`Empty skills sections: ${emptySkills}`);
    console.log(`Empty work_arrangement fields: ${emptyWorkArrangement}`);
    if (issues.length) {
      console.log("\nSpecific issues:");
      for (const i of issues) console.log(i);
    }
  }

  // 9. Expired / stale jobs
  console.log("\n\n=== QUEUE & EXPIRY ===\n");
  const { data: candidates } = await supabase
    .from("candidates")
    .select("id, status, posted_at, found_at, fit_score")
    .gte("found_at", cutoff)
    .limit(500);

  if (candidates?.length) {
    const statusCounts: Record<string, number> = {};
    for (const c of candidates) {
      statusCounts[c.status || "unknown"] = (statusCounts[c.status || "unknown"] || 0) + 1;
    }
    console.log(`Total candidates found (7d): ${candidates.length}`);
    console.log("Status breakdown:");
    for (const [k, v] of Object.entries(statusCounts).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${k}: ${v} (${((v / candidates.length) * 100).toFixed(1)}%)`);
    }

    // Fit score distribution
    const withScore = candidates.filter((c) => c.fit_score != null);
    if (withScore.length) {
      const scores = withScore.map((c) => c.fit_score as number).sort((a, b) => a - b);
      console.log(`\nFit score distribution (${withScore.length} scored):`);
      console.log(`  min: ${scores[0]}, max: ${scores[scores.length - 1]}`);
      console.log(`  median: ${scores[Math.floor(scores.length / 2)]}`);
      console.log(`  >=85 (high-fit): ${scores.filter((s) => s >= 85).length}`);
      console.log(`  >=70: ${scores.filter((s) => s >= 70).length}`);
      console.log(`  <50 (low): ${scores.filter((s) => s < 50).length}`);
    }
  }
}

main().catch(console.error);
