import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(url, key);

async function main() {
  const cutoff = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();

  // Expired applications — why did they expire?
  const { data: expired } = await supabase
    .from("resume_db_applications")
    .select("id, company, job_title, created_at, generation_status, generation_error, bid_state, generation_meta, profile_id")
    .eq("bid_state", "expired")
    .gte("created_at", cutoff)
    .order("created_at", { ascending: false })
    .limit(200);

  if (!expired?.length) {
    console.log("No expired applications.");
    return;
  }

  console.log(`=== EXPIRED APPLICATIONS: ${expired.length} ===\n`);

  // Why expired — generation didn't complete in time, or bid didn't run?
  const genCompleted = expired.filter((r) => r.generation_status === "completed");
  const genFailed = expired.filter((r) => r.generation_status === "failed");
  const genQueue = expired.filter((r) => r.generation_status === "queue");
  const genGenerating = expired.filter((r) => r.generation_status === "generating");
  const genOther = expired.filter((r) => !["completed", "failed", "queue", "generating"].includes(r.generation_status));

  console.log("Expired by generation status:");
  console.log(`  completed (resume ready, but bid expired): ${genCompleted.length}`);
  console.log(`  failed (gen failed, then expired): ${genFailed.length}`);
  console.log(`  queue (never even started generating): ${genQueue.length}`);
  console.log(`  generating (stuck mid-generation): ${genGenerating.length}`);
  if (genOther.length) console.log(`  other: ${genOther.length}`);

  // For gen-completed expired: how long between completion and expiry?
  console.log("\n--- Gen-completed but expired (resume ready, never bid) ---");
  if (genCompleted.length) {
    console.log(`Count: ${genCompleted.length}`);
    // Check how many had time between gen-complete and created_at
    const timings = genCompleted.map((r) => {
      const created = new Date(r.created_at).getTime();
      const completed = (r.generation_meta as any)?.completedAt
        ? new Date((r.generation_meta as any).completedAt).getTime()
        : 0;
      return { id: r.id, company: r.company, createdToCompleteS: completed ? (completed - created) / 1000 : null };
    });
    const withTiming = timings.filter((t) => t.createdToCompleteS != null && t.createdToCompleteS! > 0);
    if (withTiming.length) {
      const sorted = withTiming.map((t) => t.createdToCompleteS!).sort((a, b) => a - b);
      console.log(`  Generation time: median=${(sorted[Math.floor(sorted.length / 2)] / 60).toFixed(1)}min, max=${(sorted[sorted.length - 1] / 60).toFixed(1)}min`);
    }
    console.log("  Sample (first 10):");
    for (const r of genCompleted.slice(0, 10)) {
      const gm = r.generation_meta as any;
      console.log(`    #${r.id} ${r.company} — profile=${r.profile_id}, created=${r.created_at.slice(0, 16)}, genDone=${gm?.completedAt?.slice(0, 16) || "?"}`);
    }
  }

  // Gen-failed expired: what errors?
  if (genFailed.length) {
    console.log("\n--- Gen-failed then expired ---");
    const errCounts: Record<string, number> = {};
    for (const r of genFailed) {
      const err = String(r.generation_error || "unknown").slice(0, 100);
      errCounts[err] = (errCounts[err] || 0) + 1;
    }
    for (const [k, v] of Object.entries(errCounts).sort((a, b) => b[1] - a[1])) {
      console.log(`  [${v}x] ${k}`);
    }
  }

  // Still in queue expired
  if (genQueue.length) {
    console.log("\n--- Never started generating (expired in queue) ---");
    console.log(`Count: ${genQueue.length}`);
    for (const r of genQueue.slice(0, 5)) {
      console.log(`    #${r.id} ${r.company} — profile=${r.profile_id}, created=${r.created_at.slice(0, 16)}`);
    }
  }

  // Profile breakdown of expired
  const byProfile: Record<string, number> = {};
  for (const r of expired) {
    byProfile[r.profile_id || "null"] = (byProfile[r.profile_id || "null"] || 0) + 1;
  }
  console.log("\nExpired by profile:");
  for (const [k, v] of Object.entries(byProfile).sort((a, b) => b[1] - a[1])) {
    console.log(`  profile_id=${k}: ${v}`);
  }

  // Check placeholder resumes that were submitted
  console.log("\n\n=== PLACEHOLDER RESUMES THAT WERE SUBMITTED ===\n");
  const { data: submittedWithPlaceholders } = await supabase
    .from("resume_db_applications")
    .select("id, company, job_title, bid_state, apply, built_resume_json, profile_id")
    .in("bid_state", ["submitted"])
    .gte("created_at", cutoff)
    .order("id", { ascending: true })
    .limit(200);

  if (submittedWithPlaceholders?.length) {
    let count = 0;
    for (const r of submittedWithPlaceholders) {
      if (!r.built_resume_json) continue;
      if (/Extracted Company|\[JD[\s\w]*\]|City,\s*ST/i.test(r.built_resume_json)) {
        count++;
        if (count <= 10) {
          // Find what placeholder text
          const matches: string[] = [];
          if (/Extracted Company/i.test(r.built_resume_json)) matches.push("Extracted Company");
          if (/\[JD[\s\w]*\]/i.test(r.built_resume_json)) matches.push("[JD...]");
          if (/City,\s*ST/i.test(r.built_resume_json)) matches.push("City, ST");
          console.log(`  #${r.id} ${r.company} (profile=${r.profile_id}, registered=${r.apply === "Registered"}): ${matches.join(", ")}`);
        }
      }
    }
    console.log(`\nTotal submitted with placeholder text: ${count} / ${submittedWithPlaceholders.length}`);
  }
}

main().catch(console.error);
