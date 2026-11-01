import { beforeEach, describe, expect, it, vi } from "vitest";
import { saveRunnerStatus } from "@/lib/autobid/status";

/** A one-row app_users table: select(column).eq().maybeSingle() and update().eq(). */
const db = vi.hoisted(() => ({ row: { id: "u1" } as Record<string, unknown> }));

vi.mock("@/lib/supabase/admin", () => {
  function query() {
    let column = "";
    let patch: Record<string, unknown> | null = null;
    const builder = {
      select(name: string) {
        column = name;
        return builder;
      },
      update(values: Record<string, unknown>) {
        patch = values;
        return builder;
      },
      eq() {
        if (patch) {
          Object.assign(db.row, patch);
          return Promise.resolve({ error: null });
        }
        return builder;
      },
      async maybeSingle() {
        return { data: { [column]: db.row[column] ?? null }, error: null };
      },
    };
    return builder;
  }
  return { getSupabaseAdminClient: () => ({ from: () => query() }) };
});

describe("saveRunnerStatus", () => {
  beforeEach(() => {
    db.row = { id: "u1" };
  });

  it("returns who wrote the report it replaced, so a panel sees another one is open", async () => {
    expect(await saveRunnerStatus("u1", "autobid", { instanceId: "panel-a", state: "off" })).toBeNull();
    const previous = await saveRunnerStatus("u1", "autobid", { instanceId: "panel-b", state: "off" });
    expect(previous?.instanceId).toBe("panel-a");
    expect(Date.parse(previous?.reportedAt ?? "")).toBeGreaterThan(0);
    expect((db.row.autobid_status as Record<string, unknown>).instanceId).toBe("panel-b");
  });

  it("reports an older panel, which sends no instanceId, as unknown", async () => {
    db.row.autobid_status = { state: "running", reportedAt: "2026-11-01T08:00:00.000Z" };
    expect(await saveRunnerStatus("u1", "autobid", { instanceId: "panel-a" })).toEqual({
      instanceId: null,
      reportedAt: "2026-11-01T08:00:00.000Z",
    });
  });
});
