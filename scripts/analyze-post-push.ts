import { createClient } from "@supabase/supabase-js";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function main() {
  // Latest push: Nov 12, 2026 ~20:55 UTC (15:55 EST)
  const cutoff = "2026-11-12T20:55:00Z";

  const { data: rows, error } = await sb
    .from("resume_db_applications")
    .select("id, profile_id, company, job_title, ats_platform, generation_status, generation_error, generation_meta, bid_state, bid_error, bid_meta, applied_at, created_at, resume_drive_file_id, resume_url, built_resume_json")
    .or(`applied_at.gte.${cutoff},created_at.gte.${cutoff}`)
    .order("id", { ascending: false })
    .limit(200);

  if (error) {
    console.error("Query error:", error.message);
    return;
  }

  console.log(`=== Auto-bid activity after push (${cutoff}) ===`);
  console.log(`Total rows: ${rows?.length ?? 0}\n`);

  const stats = {
    total: 0, generated: 0, genFailed: 0, generating: 0, queued: 0,
    bidSent: 0, bidFailed: 0, bidNeedsYou: 0, bidApplying: 0, notAttempted: 0,
    hasDriveFile: 0, noDriveFile: 0,
  };

  const issues: any[] = [];

  for (const r of rows ?? []) {
    stats.total++;
    if (r.generation_status === "completed") stats.generated++;
    if (r.generation_status === "failed") {
      stats.genFailed++;
      issues.push({ id: r.id, type: "gen_failed", company: r.company, error: r.generation_error });
    }
    if (r.generation_status === "generating") stats.generating++;
    if (r.generation_status === "queue") stats.queued++;

    if (r.bid_state === "submitted") stats.bidSent++;
    if (r.bid_state === "failed") {
      stats.bidFailed++;
      issues.push({ id: r.id, type: "bid_failed", company: r.company, ats: r.ats_platform, error: r.bid_error, meta: r.bid_meta });
    }
    if (r.bid_state === "needs_you") {
      stats.bidNeedsYou++;
      issues.push({ id: r.id, type: "needs_you", company: r.company, ats: r.ats_platform, error: r.bid_error, meta: r.bid_meta });
    }
    if (r.bid_state === "bidding") stats.bidApplying++;
    if (r.bid_state === "none" || !r.bid_state) stats.notAttempted++;

    if (r.resume_drive_file_id) stats.hasDriveFile++;
    else stats.noDriveFile++;

    if (r.built_resume_json) {
      if (/\bExtracted Company\b/i.test(r.built_resume_json) || /\[JD[\s\w]*\]/i.test(r.built_resume_json)) {
        issues.push({ id: r.id, type: "PLACEHOLDER_IN_JSON", company: r.company });
      }
    }
  }

  console.log("--- Summary ---");
  console.log(`  Total rows:        ${stats.total}`);
  console.log(`  Gen completed:     ${stats.generated}`);
  console.log(`  Gen failed:        ${stats.genFailed}`);
  console.log(`  Gen generating:    ${stats.generating}`);
  console.log(`  Gen queued:        ${stats.queued}`);
  console.log(`  Bid sent:          ${stats.bidSent}`);
  console.log(`  Bid failed:        ${stats.bidFailed}`);
  console.log(`  Bid needs_you:     ${stats.bidNeedsYou}`);
  console.log(`  Bid applying:      ${stats.bidApplying}`);
  console.log(`  Bid not attempted: ${stats.notAttempted}`);
  console.log(`  Has Drive file:    ${stats.hasDriveFile}`);
  console.log(`  No Drive file:     ${stats.noDriveFile}`);

  console.log(`\n--- Issues (${issues.length}) ---`);
  for (const issue of issues) {
    console.log(`\n[#${issue.id}] ${issue.type} - ${issue.company ?? "?"}`);
    if (issue.ats) console.log(`  ATS: ${issue.ats}`);
    if (issue.error) console.log(`  Error: ${(issue.error as string).substring(0, 300)}`);
    if (issue.meta) {
      const m = issue.meta as any;
      if (m.failReason) console.log(`  Fail reason: ${m.failReason}`);
      if (m.failDetail) console.log(`  Fail detail: ${String(m.failDetail).substring(0, 300)}`);
      if (m.stoppedReason) console.log(`  Stopped reason: ${m.stoppedReason}`);
      if (m.stoppedDetail) console.log(`  Stopped detail: ${String(m.stoppedDetail).substring(0, 300)}`);
      if (m.lastStep) console.log(`  Last step: ${m.lastStep}`);
      if (m.finishedAt) console.log(`  Finished at: ${m.finishedAt}`);
    }
  }

  console.log(`\n--- All rows (newest first) ---`);
  for (const r of rows ?? []) {
    const gen = (r.generation_status ?? "none").padEnd(10);
    const bid = (r.bid_state ?? "none").padEnd(12);
    const drive = r.resume_drive_file_id ? "drive" : "no-drv";
    const applied = r.applied_at ? new Date(r.applied_at).toISOString().replace("T", " ").substring(0, 19) : "-";
    console.log(`  #${String(r.id).padEnd(5)} ${(r.company ?? "?").padEnd(25)} gen=${gen} bid=${bid} ${drive.padEnd(6)} applied=${applied}`);
  }
}

main().catch(console.error);
