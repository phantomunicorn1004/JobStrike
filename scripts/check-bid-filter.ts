import { createClient } from "@supabase/supabase-js";
import { BID_STATES, type BidState } from "../lib/resume-db/types";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(url, key);

async function main() {
  // Count per state with head queries — a plain select caps at 1000 rows.
  const counts: Record<string, number> = {};
  console.log("=== bid_state distribution ===");
  for (const s of BID_STATES) {
    const { count, error } = await supabase
      .from("resume_db_applications")
      .select("id", { count: "exact", head: true })
      .in("bid_state", [s]);
    if (error) { console.error("QUERY ERROR:", error); return; }
    counts[s] = count ?? 0;
    console.log(`  ${s.padEnd(11)} ${counts[s]}`);
  }

  // The six states must partition the table exactly: no row falls outside them.
  const { count: total } = await supabase
    .from("resume_db_applications")
    .select("id", { count: "exact", head: true });
  const summed = BID_STATES.reduce((n, s) => n + counts[s], 0);
  console.log(`\n=== partition check ===`);
  console.log(`  sum of states ${summed}, table total ${total ?? 0}  ${summed === total ? "OK" : "MISMATCH — unknown bid_state values exist"}`);

  // Multi-select must return the sum.
  const combo: BidState[] = ["needs_you", "failed", "expired"];
  const { count: comboCount } = await supabase
    .from("resume_db_applications")
    .select("id", { count: "exact", head: true })
    .in("bid_state", combo);
  const comboExpected = combo.reduce((n, s) => n + (counts[s] ?? 0), 0);
  console.log(`\n=== multi-select [${combo.join(", ")}] ===`);
  console.log(`  got ${comboCount ?? 0}, expected ${comboExpected}  ${comboCount === comboExpected ? "OK" : "MISMATCH"}`);
}

main().catch(console.error);
