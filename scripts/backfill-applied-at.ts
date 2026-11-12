/**
 * Restamps applied_at from the real send time for auto-bid rows.
 *
 * applied_at is DEFAULT NOW() at insert, which for an auto-bid row is when the
 * scraper queued the job — often hours before Submit. Rows the runner actually
 * sent carry the true time in bid_meta.confirmedAt (fall back to finishedAt).
 *
 * Run with --apply to write; without it, prints the changes only.
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(url, key);

const APPLY = process.argv.includes("--apply");

async function main() {
  const { data: apps, error } = await supabase
    .from("resume_db_applications")
    .select("id, company, applied_at, bid_meta")
    .eq("bid_state", "submitted");

  if (error) { console.error("QUERY ERROR:", error); return; }

  const fixes: { id: number; company: string; from: string; to: string; driftMin: number }[] = [];

  for (const app of apps || []) {
    const bm = (app.bid_meta || {}) as Record<string, unknown>;
    const sent = (bm.confirmedAt || bm.finishedAt) as string | undefined;
    if (!sent) continue;
    const to = new Date(sent);
    const from = new Date(app.applied_at);
    if (!Number.isFinite(to.getTime()) || !Number.isFinite(from.getTime())) continue;
    const driftMs = to.getTime() - from.getTime();
    if (Math.abs(driftMs) < 60_000) continue; // already within a minute
    fixes.push({
      id: app.id,
      company: app.company,
      from: app.applied_at,
      to: to.toISOString(),
      driftMin: Math.round(driftMs / 60_000),
    });
  }

  fixes.sort((a, b) => Math.abs(b.driftMin) - Math.abs(a.driftMin));

  console.log(`${APPLY ? "APPLYING" : "DRY RUN"} — ${fixes.length} of ${apps?.length ?? 0} submitted rows need restamping\n`);
  for (const f of fixes) {
    console.log(`#${f.id} ${f.company}`);
    console.log(`   ${f.from}  ->  ${f.to}   (${f.driftMin >= 0 ? "+" : ""}${f.driftMin} min)`);
  }

  if (!APPLY) {
    console.log("\nRe-run with --apply to write these changes.");
    return;
  }

  let ok = 0;
  for (const f of fixes) {
    const { error: upErr } = await supabase
      .from("resume_db_applications")
      .update({ applied_at: f.to } as never)
      .eq("id", f.id);
    if (upErr) console.error(`  #${f.id} FAILED: ${upErr.message}`);
    else ok++;
  }
  console.log(`\nUpdated ${ok}/${fixes.length} rows.`);
}

main().catch(console.error);
