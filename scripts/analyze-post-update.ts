import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(url, key);

async function main() {
  // Get all recent applications to find the update boundary
  const { data: recent } = await supabase
    .from("resume_db_applications")
    .select("id, profile_id, company, job_title, created_at, generation_status, generation_error, generation_meta, bid_state, bid_error, bid_meta, apply, built_resume_json")
    .order("created_at", { ascending: false })
    .limit(300);

  if (!recent?.length) {
    console.log("No recent applications found.");
    return;
  }

  // Find the update boundary by looking for signs of new code:
  // - generation_meta.warnings array present (finalize checks)
  // - generation_meta.restored array present
  // - or look at time gaps
  console.log("=== RECENT APPLICATIONS (newest first) ===\n");
  console.log(`Newest: #${recent[0].id} ${recent[0].created_at}`);
  console.log(`Oldest in batch: #${recent[recent.length - 1].id} ${recent[recent.length - 1].created_at}\n`);

  // Look for the deployment boundary — check generation_meta for new fields
  let preUpdateCount = 0;
  let postUpdateCount = 0;
  let boundaryId: number | null = null;
  let boundaryTime: string | null = null;

  for (const r of recent) {
    const gm = r.generation_meta as any;
    // New code sets warnings/restored arrays; also check for autoRetryCount
    const hasNewFields = gm && (Array.isArray(gm.warnings) || Array.isArray(gm.restored) || gm.autoRetryCount != null);
    if (hasNewFields) {
      postUpdateCount++;
      if (!boundaryId || r.id < boundaryId) {
        boundaryId = r.id;
        boundaryTime = r.created_at;
      }
    } else if (r.generation_status === "completed" || r.generation_status === "failed") {
      preUpdateCount++;
    }
  }

  console.log(`Post-update apps (with new meta fields): ${postUpdateCount}`);
  console.log(`Pre-update apps (no new meta fields): ${preUpdateCount}`);
  if (boundaryTime) {
    console.log(`Earliest post-update app: #${boundaryId} at ${boundaryTime}`);
  }

  // Use the last 48 hours as analysis window (should capture post-update period)
  const cutoff48h = new Date(Date.now() - 48 * 3600_000).toISOString();
  const cutoff24h = new Date(Date.now() - 24 * 3600_000).toISOString();
  const cutoff12h = new Date(Date.now() - 12 * 3600_000).toISOString();
  const cutoff6h = new Date(Date.now() - 6 * 3600_000).toISOString();

  for (const [label, cutoff] of [["Last 48h", cutoff48h], ["Last 24h", cutoff24h], ["Last 12h", cutoff12h], ["Last 6h", cutoff6h]] as const) {
    const window = recent.filter((r) => r.created_at >= cutoff);
    if (!window.length) {
      console.log(`\n=== ${label}: No applications ===`);
      continue;
    }

    console.log(`\n=== ${label}: ${window.length} applications ===\n`);

    // Generation status
    const genCounts: Record<string, number> = {};
    for (const r of window) genCounts[r.generation_status || "unknown"] = (genCounts[r.generation_status || "unknown"] || 0) + 1;
    console.log("Generation:");
    for (const [k, v] of Object.entries(genCounts).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${k}: ${v} (${((v / window.length) * 100).toFixed(1)}%)`);
    }

    // Bid state
    const bidCounts: Record<string, number> = {};
    for (const r of window) bidCounts[r.bid_state || "none"] = (bidCounts[r.bid_state || "none"] || 0) + 1;
    console.log("Bid state:");
    for (const [k, v] of Object.entries(bidCounts).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${k}: ${v} (${((v / window.length) * 100).toFixed(1)}%)`);
    }

    // Apply status
    const applyCounts: Record<string, number> = {};
    for (const r of window) applyCounts[r.apply || "?"] = (applyCounts[r.apply || "?"] || 0) + 1;
    console.log("Apply:");
    for (const [k, v] of Object.entries(applyCounts).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${k}: ${v}`);
    }

    // Placeholder check
    let placeholderCount = 0;
    let instructionLeak = 0;
    const completedInWindow = window.filter((r) => r.generation_status === "completed" && r.built_resume_json);
    for (const r of completedInWindow) {
      if (/Extracted Company|\[JD[\s\w]*\]|City,\s*ST/i.test(r.built_resume_json!)) placeholderCount++;
      if (/replace each instruction|template completion task|STEP \d|JD ANALYSIS/i.test(r.built_resume_json!)) instructionLeak++;
    }
    console.log(`Resume quality: ${completedInWindow.length} completed, ${placeholderCount} with placeholder text, ${instructionLeak} with instruction leaks`);

    // Gen failures detail
    const failures = window.filter((r) => r.generation_status === "failed");
    if (failures.length) {
      const errCounts: Record<string, number> = {};
      for (const r of failures) {
        const err = String(r.generation_error || "unknown").slice(0, 120);
        errCounts[err] = (errCounts[err] || 0) + 1;
      }
      console.log("Gen failure reasons:");
      for (const [k, v] of Object.entries(errCounts).sort((a, b) => b[1] - a[1])) {
        console.log(`  [${v}x] ${k}`);
      }
    }

    // Finalize rejections (new code marks these as failed with specific errors)
    const finalizeRejections = failures.filter((r) => {
      const err = String(r.generation_error || "");
      return /checks|placeholder|instruction|Kit:|VERBATIM/i.test(err);
    });
    if (finalizeRejections.length) {
      console.log(`Finalize rejections (new validation): ${finalizeRejections.length}`);
      for (const r of finalizeRejections) {
        console.log(`  #${r.id} ${r.company}: ${String(r.generation_error).slice(0, 150)}`);
      }
    }

    // Needs_you detail
    const needsYou = window.filter((r) => r.bid_state === "needs_you");
    if (needsYou.length) {
      const nyCounts: Record<string, number> = {};
      for (const r of needsYou) {
        const reason = String(r.bid_error || "unknown").slice(0, 80);
        nyCounts[reason] = (nyCounts[reason] || 0) + 1;
      }
      console.log("Needs_you reasons:");
      for (const [k, v] of Object.entries(nyCounts).sort((a, b) => b[1] - a[1])) {
        console.log(`  [${v}x] ${k}`);
      }
    }

    // Auto-retry evidence
    const retried = window.filter((r) => {
      const gm = r.generation_meta as any;
      return gm?.autoRetryCount > 0;
    });
    if (retried.length) {
      console.log(`Auto-retried (gen): ${retried.length}`);
    }

    // Timing
    const genTimed = window.filter((r) => r.generation_status === "completed" && (r.generation_meta as any)?.completedAt);
    if (genTimed.length) {
      const times = genTimed.map((r) => {
        const created = new Date(r.created_at).getTime();
        const done = new Date((r.generation_meta as any).completedAt).getTime();
        return (done - created) / 1000;
      }).filter((t) => t > 0 && t < 7200);
      if (times.length) {
        times.sort((a, b) => a - b);
        console.log(`Gen time: median=${(times[Math.floor(times.length / 2)] / 60).toFixed(1)}min, p90=${(times[Math.floor(times.length * 0.9)] / 60).toFixed(1)}min, max=${(times[times.length - 1] / 60).toFixed(1)}min`);
      }
    }
  }

  // Recent submitted list
  console.log("\n\n=== MOST RECENT SUBMITTED (last 20) ===\n");
  const submitted = recent.filter((r) => r.bid_state === "submitted").slice(0, 20);
  for (const r of submitted) {
    const gm = r.generation_meta as any;
    const bm = r.bid_meta as any;
    const hasPlaceholder = r.built_resume_json && /Extracted Company|\[JD[\s\w]*\]|City,\s*ST/i.test(r.built_resume_json);
    const warnings = gm?.warnings?.length ? `warnings=[${gm.warnings.join(", ")}]` : "";
    const restored = gm?.restored?.length ? `restored=${gm.restored.length}fields` : "";
    console.log(`  #${r.id} ${r.company} — "${r.job_title?.slice(0, 40)}" (${r.created_at.slice(0, 16)})`);
    console.log(`    profile=${r.profile_id}, registered=${r.apply === "Registered"}, placeholder=${hasPlaceholder ? "YES!" : "no"} ${warnings} ${restored}`);
  }

  // Check for any generation_meta with new finalize fields
  console.log("\n\n=== FINALIZE VALIDATION EVIDENCE ===\n");
  const withWarnings = recent.filter((r) => {
    const gm = r.generation_meta as any;
    return gm?.warnings?.length > 0;
  });
  if (withWarnings.length) {
    console.log(`Applications with finalize warnings: ${withWarnings.length}`);
    for (const r of withWarnings.slice(0, 10)) {
      const gm = r.generation_meta as any;
      console.log(`  #${r.id} ${r.company}: warnings=${JSON.stringify(gm.warnings)}`);
    }
  } else {
    console.log("No applications with finalize warnings found.");
  }

  const withRestored = recent.filter((r) => {
    const gm = r.generation_meta as any;
    return gm?.restored?.length > 0;
  });
  if (withRestored.length) {
    console.log(`\nApplications with restored fields: ${withRestored.length}`);
    for (const r of withRestored.slice(0, 10)) {
      const gm = r.generation_meta as any;
      console.log(`  #${r.id} ${r.company}: restored=${JSON.stringify(gm.restored)}`);
    }
  } else {
    console.log("No applications with restored fields found.");
  }
}

main().catch(console.error);
