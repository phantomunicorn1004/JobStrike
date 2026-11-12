/**
 * Checks the Resume DB list sorts the way applySortOrder builds them: nulls sink
 * in both directions, and the id tiebreak keeps paging from repeating or skipping
 * a row. Read-only.
 */
import { createClient } from "@supabase/supabase-js";
import { BID_STATE_LABELS, toBidState } from "../lib/resume-db/types";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(url, key);

const COLS = "id, company, job_title, applied_at, bid_state";

function page(column: string, ascending: boolean, from: number, to: number) {
  return supabase
    .from("resume_db_applications")
    .select(COLS)
    .order(column, { ascending, nullsFirst: false })
    .order("id", { ascending: false })
    .range(from, to);
}

type Row = {
  id: number;
  company: string | null;
  job_title: string | null;
  applied_at: string | null;
  bid_state: string | null;
};

async function show(label: string, column: string, ascending: boolean) {
  const { data, error } = await page(column, ascending, 0, 4);
  if (error) {
    console.error(`  QUERY ERROR on ${column}:`, error.message);
    return;
  }
  console.log(`\n=== ${label} ===`);
  for (const r of (data ?? []) as Row[]) {
    const applied = r.applied_at ? r.applied_at.slice(0, 16).replace("T", " ") : "(null)";
    const bid = BID_STATE_LABELS[toBidState(r.bid_state)];
    console.log(
      `  #${String(r.id).padEnd(5)} ${applied.padEnd(17)} ${bid.padEnd(13)} ${(r.company ?? "").slice(0, 28)}`,
    );
  }
}

/** Two consecutive pages must not share an id, or the sort is not total. */
async function checkPaging(column: string, ascending: boolean) {
  const size = 25;
  const [a, b] = await Promise.all([
    page(column, ascending, 0, size - 1),
    page(column, ascending, size, size * 2 - 1),
  ]);
  if (a.error || b.error) {
    console.error(`  QUERY ERROR paging ${column}:`, (a.error ?? b.error)?.message);
    return;
  }
  const first = ((a.data ?? []) as Row[]).map((r) => r.id);
  const second = ((b.data ?? []) as Row[]).map((r) => r.id);
  const overlap = second.filter((id) => first.includes(id));
  const dupesInPage = first.length !== new Set(first).size;
  console.log(
    `  ${column.padEnd(11)} ${ascending ? "asc " : "desc"}  page1=${first.length} page2=${second.length}` +
      `  overlap=${overlap.length}  ${overlap.length === 0 && !dupesInPage ? "OK" : "UNSTABLE"}`,
  );
}

/** Rows with no applied_at must land at the bottom whichever way we sort. */
async function checkNullsSink() {
  const { count: nulls } = await supabase
    .from("resume_db_applications")
    .select("id", { count: "exact", head: true })
    .is("applied_at", null);
  console.log(`\n=== applied_at nulls ===`);
  console.log(`  ${nulls ?? 0} row(s) with no applied_at`);
  if (!nulls) {
    console.log("  nothing to place — nullsFirst:false is untested against real data");
    return;
  }
  for (const ascending of [true, false]) {
    const { data } = await page("applied_at", ascending, 0, 0);
    const top = ((data ?? []) as Row[])[0];
    console.log(
      `  ${ascending ? "asc " : "desc"} top row applied_at=${top?.applied_at ?? "(null)"}` +
        `  ${top?.applied_at ? "OK — nulls not on top" : "BAD — null floated to top"}`,
    );
  }
}

async function main() {
  await show("applied_at desc (first click on Applied)", "applied_at", false);
  await show("applied_at asc", "applied_at", true);
  await show("bid_state asc (first click on Bid)", "bid_state", true);

  console.log(`\n=== paging stability (two 25-row pages must not overlap) ===`);
  for (const [column, ascending] of [
    ["applied_at", false],
    ["applied_at", true],
    ["bid_state", true],
    ["company", true],
    ["job_title", true],
  ] as const) {
    await checkPaging(column, ascending);
  }

  await checkNullsSink();
}

main().catch(console.error);
