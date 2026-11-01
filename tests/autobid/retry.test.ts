import { beforeEach, describe, expect, it, vi } from "vitest";
import { retryBids } from "@/lib/autobid/claim";
import { QUEUED_APPLY } from "@/lib/resume-db/types";

/**
 * A small resume_db_applications table that understands the filters
 * retryBids uses, including the PostgREST `or` on bid_meta->>submitClicked.
 */
type Row = { id: number; user_id: string; bid_state: string; apply: string; bid_meta: Record<string, unknown> | null };
const db = vi.hoisted(() => ({ rows: [] as Row[] }));

vi.mock("@/lib/supabase/admin", () => {
  function metaText(row: Row, key: string): string | null {
    const value = row.bid_meta?.[key];
    return value === undefined || value === null ? null : String(value);
  }
  function query() {
    const filters: Array<(row: Row) => boolean> = [];
    let patch: Partial<Row> | null = null;
    const builder = {
      update(values: Partial<Row>) {
        patch = values;
        return builder;
      },
      eq(column: keyof Row, value: unknown) {
        filters.push((row) => row[column] === value);
        return builder;
      },
      in(column: keyof Row, values: unknown[]) {
        filters.push((row) => values.includes(row[column]));
        return builder;
      },
      or(expression: string) {
        const parts = expression.split(",").map((part) => {
          const m = part.match(/^bid_meta->>(\w+)\.(is|neq)\.(.+)$/);
          if (!m) throw new Error(`unsupported filter ${part}`);
          const [, key, op, value] = m;
          return (row: Row) => {
            const text = metaText(row, key);
            // PostgREST: NULL never matches neq, only is.null.
            return op === "is" ? text === null : text !== null && text !== value;
          };
        });
        filters.push((row) => parts.some((test) => test(row)));
        return builder;
      },
      async select() {
        const hit = db.rows.filter((row) => filters.every((f) => f(row)));
        if (patch) for (const row of hit) Object.assign(row, patch);
        return { data: hit.map((row) => ({ id: row.id })), error: null };
      },
    };
    return builder;
  }
  return { getSupabaseAdminClient: () => ({ from: () => query() }) };
});

function row(id: number, bid_state: string, bid_meta: Record<string, unknown> | null = {}): Row {
  return { id, user_id: "u1", bid_state, apply: QUEUED_APPLY, bid_meta };
}

describe("retryBids", () => {
  beforeEach(() => {
    db.rows = [
      row(1, "needs_you", { step: "", reason: "Required field not filled" }),
      row(2, "needs_you", null),
      row(3, "needs_you", { submitClicked: true }),
      row(4, "failed", { submitClicked: false }),
      row(5, "submitted", { submitClicked: true }),
    ];
  });

  it("gives back jobs that were not submitted, and never one where Submit was pressed", async () => {
    expect(await retryBids("u1", [1, 2, 3, 4, 5])).toBe(3);
    expect(db.rows.map((r) => [r.id, r.bid_state])).toEqual([
      [1, "none"],
      [2, "none"],
      [3, "needs_you"],
      [4, "none"],
      [5, "submitted"],
    ]);
  });

  it("refuses a lone job where Submit was pressed", async () => {
    expect(await retryBids("u1", [3])).toBe(0);
    expect(db.rows[2].bid_state).toBe("needs_you");
  });
});
