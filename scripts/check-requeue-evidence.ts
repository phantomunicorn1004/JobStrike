import { createClient } from "@supabase/supabase-js";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function main() {
  // Check for evidence of requeue: rows where bid_state is "submitted" but
  // built_resume_json was regenerated (generation_meta.completedAt AFTER applied_at)
  const { data: rows } = await sb
    .from("resume_db_applications")
    .select("id, company, job_title, created_at, applied_at, generation_status, generation_meta, bid_state, bid_meta, resume_drive_file_id")
    .eq("profile_id", 4)
    .eq("bid_state", "submitted")
    .eq("generation_status", "completed")
    .not("resume_drive_file_id", "is", null)
    .order("id", { ascending: false })
    .limit(30);

  console.log("=== Profile 4 submitted rows with Drive files ===");
  console.log("Looking for rows where generation completed AFTER bid (evidence of regeneration)\n");

  for (const r of rows ?? []) {
    const gm = r.generation_meta ?? {} as any;
    const bm = r.bid_meta ?? {} as any;
    const genAt = gm.completedAt ? new Date(gm.completedAt).getTime() : 0;
    const bidAt = bm.finishedAt ? new Date(bm.finishedAt).getTime() :
                  (r.applied_at ? new Date(r.applied_at).getTime() : 0);

    const genAfterBid = genAt > bidAt && bidAt > 0;
    const flag = genAfterBid ? " *** REGEN AFTER BID ***" : "";
    const retryCount = gm.autoRetryCount ?? 0;
    const retryFlag = retryCount > 0 ? ` (retry #${retryCount})` : "";

    console.log(`#${r.id} ${(r.company ?? "").padEnd(20)} gen=${gm.completedAt ?? "?"} bid=${bm.finishedAt ?? r.applied_at ?? "?"} ${retryFlag}${flag}`);
  }

  // Also check: how many profile 4 rows have autoRetryCount > 0?
  const { data: retried } = await sb
    .from("resume_db_applications")
    .select("id, company, generation_meta")
    .eq("profile_id", 4)
    .not("generation_meta", "is", null)
    .order("id", { ascending: false })
    .limit(200);

  const withRetry = (retried ?? []).filter((r: any) => r.generation_meta?.autoRetryCount > 0);
  console.log(`\n=== Rows with autoRetryCount > 0: ${withRetry.length} ===`);
  for (const r of withRetry) {
    const gm = r.generation_meta as any;
    console.log(`  #${r.id} ${r.company} - retryCount=${gm.autoRetryCount} retryAt=${gm.autoRetryAt}`);
  }

  // Check row #2819 specifically: does it have any retry evidence?
  const { data: row } = await sb
    .from("resume_db_applications")
    .select("id, generation_meta")
    .eq("id", 2819)
    .single();

  console.log(`\n=== Row #2819 generation_meta keys: ${Object.keys(row?.generation_meta ?? {}).join(", ")} ===`);
  console.log("autoRetryCount:", (row?.generation_meta as any)?.autoRetryCount ?? "NOT PRESENT");
  console.log("autoRetryAt:", (row?.generation_meta as any)?.autoRetryAt ?? "NOT PRESENT");
}

main().catch(console.error);
