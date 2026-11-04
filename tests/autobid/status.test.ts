import { beforeEach, describe, expect, it, vi } from "vitest";
import { saveRunnerStatus } from "@/lib/autobid/status";

/**
 * A one-row app_users table (select(column).eq().maybeSingle() and update().eq())
 * and the autobid_workers table (upsert, one row per instance).
 */
const db = vi.hoisted(() => ({
  row: { id: "u1" } as Record<string, unknown>,
  workers: new Map<string, Record<string, unknown>>(),
}));

vi.mock("@/lib/supabase/admin", () => {
  function workers() {
    return {
      async upsert(values: Record<string, unknown>) {
        db.workers.set(String(values.instance_id), values);
        return { error: null };
      },
    };
  }
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
  return {
    getSupabaseAdminClient: () => ({ from: (table: string) => (table === "autobid_workers" ? workers() : query()) }),
  };
});

describe("saveRunnerStatus", () => {
  beforeEach(() => {
    db.row = { id: "u1" };
    db.workers = new Map();
  });

  it("returns who wrote the report it replaced, so a panel sees another one is open", async () => {
    expect(await saveRunnerStatus("u1", "autobid", { instanceId: "panel-a", state: "off" })).toBeNull();
    const previous = await saveRunnerStatus("u1", "autobid", { instanceId: "panel-b", state: "off" });
    expect(previous?.instanceId).toBe("panel-a");
    expect(Date.parse(previous?.reportedAt ?? "")).toBeGreaterThan(0);
    expect((db.row.autobid_status as Record<string, unknown>).instanceId).toBe("panel-b");
  });

  it("keeps one worker row per machine, so two panels do not hide each other", async () => {
    await saveRunnerStatus("u1", "autobid", { instanceId: "panel-a" });
    await saveRunnerStatus("u1", "autobid", { instanceId: "panel-b" });
    await saveRunnerStatus("u1", "autogen", { windows: [] });
    expect([...db.workers.keys()].sort()).toEqual(["autogen-default", "panel-a", "panel-b"]);
    expect(db.workers.get("autogen-default")?.kind).toBe("autogen");
  });

  it("reports an older panel, which sends no instanceId, as unknown", async () => {
    db.row.autobid_status = { state: "running", reportedAt: "2026-11-01T08:00:00.000Z" };
    expect(await saveRunnerStatus("u1", "autobid", { instanceId: "panel-a" })).toEqual({
      instanceId: null,
      reportedAt: "2026-11-01T08:00:00.000Z",
    });
  });
});
