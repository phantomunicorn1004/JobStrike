import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(url, key);

async function main() {
  const cutoff12h = new Date(Date.now() - 12 * 3600_000).toISOString();

  // Get recent completed applications with built_resume_json
  const { data: apps } = await supabase
    .from("resume_db_applications")
    .select("id, profile_id, company, job_title, generation_meta, built_resume_json, bid_state, bid_error")
    .eq("generation_status", "completed")
    .gte("created_at", cutoff12h)
    .order("id", { ascending: false })
    .limit(50);

  if (!apps?.length) {
    console.log("No completed apps in last 12h.");
    return;
  }

  const getText = (f: unknown): string => {
    if (typeof f === "string") return f;
    if (typeof f === "object" && f !== null) return String((f as { text?: string }).text || "");
    return "";
  };

  console.log(`=== RESUME QUALITY DETAILS (last 12h, ${apps.length} completed) ===\n`);

  for (const r of apps.slice(0, 15)) {
    if (!r.built_resume_json) continue;
    const json = JSON.parse(r.built_resume_json);
    const gm = r.generation_meta as any;
    const work = json.work_experience || {};
    const experiences = Object.keys(work).filter((k) => k.startsWith("experience_")).sort();

    console.log(`#${r.id} ${r.company} (profile=${r.profile_id}, bid=${r.bid_state})`);
    console.log(`  Title: ${r.job_title?.slice(0, 60)}`);

    // Companies
    for (const ek of experiences) {
      const role = work[ek];
      console.log(`  ${ek}: ${getText(role.company)} | ${getText(role.role_title)} | ${getText(role.location)}`);
    }

    // Summary snippet
    const summary = json.summary;
    const summaryText = getText(summary);
    if (summaryText) console.log(`  Summary: "${summaryText.slice(0, 100)}..."`);

    // Skills check
    const tech = json.technology_stack || json.skills;
    if (tech) {
      const skillTexts = Object.entries(tech)
        .filter(([k]) => k.startsWith("skill_items"))
        .map(([, v]) => getText(v))
        .filter(Boolean);
      console.log(`  Skills groups: ${skillTexts.length}, sample: "${(skillTexts[0] || "").slice(0, 80)}"`);
    } else {
      console.log(`  Skills: MISSING`);
    }

    // Warnings / restored
    if (gm?.warnings?.length) console.log(`  Warnings: ${gm.warnings.join("; ")}`);
    if (gm?.restored?.length) console.log(`  Restored: ${gm.restored.length} fields`);

    // Check for issues
    const raw = r.built_resume_json!;
    const issues: string[] = [];
    if (/Extracted Company|\[JD[\s\w]*\]|City,\s*ST/i.test(raw)) issues.push("PLACEHOLDER TEXT");
    if (/replace each instruction|template completion/i.test(raw)) issues.push("INSTRUCTION LEAK");

    // Empty work_arrangement
    for (const ek of experiences) {
      const wa = work[ek]?.work_arrangement;
      const waText = getText(wa);
      if (!waText) issues.push(`${ek}.work_arrangement=empty`);
    }

    if (issues.length) console.log(`  ISSUES: ${issues.join(", ")}`);
    console.log("");
  }

  // Profile comparison
  console.log("\n=== PROFILE COMPARISON ===\n");
  const byProfile: Record<string, typeof apps> = {};
  for (const r of apps) {
    const pid = String(r.profile_id || "null");
    if (!byProfile[pid]) byProfile[pid] = [];
    byProfile[pid].push(r);
  }

  for (const [pid, pApps] of Object.entries(byProfile)) {
    console.log(`Profile ${pid}: ${pApps.length} apps`);
    let placeholder = 0;
    let emptyWA = 0;

    for (const r of pApps) {
      if (!r.built_resume_json) continue;
      if (/Extracted Company|\[JD[\s\w]*\]|City,\s*ST/i.test(r.built_resume_json)) placeholder++;
      const json = JSON.parse(r.built_resume_json);
      const work = json.work_experience || {};
      for (const ek of Object.keys(work).filter((k) => k.startsWith("experience_"))) {
        const wa = getText(work[ek]?.work_arrangement);
        if (!wa) emptyWA++;
      }
    }
    console.log(`  Placeholder issues: ${placeholder}`);
    console.log(`  Empty work_arrangements: ${emptyWA}`);
    console.log(`  Bid states: ${pApps.map((r) => r.bid_state).reduce((acc: Record<string, number>, s) => { acc[s || "none"] = (acc[s || "none"] || 0) + 1; return acc; }, {} as Record<string, number>)}`);

    // Show bid states properly
    const bs: Record<string, number> = {};
    for (const r of pApps) bs[r.bid_state || "none"] = (bs[r.bid_state || "none"] || 0) + 1;
    for (const [k, v] of Object.entries(bs)) console.log(`    ${k}: ${v}`);
  }
}

main().catch(console.error);
