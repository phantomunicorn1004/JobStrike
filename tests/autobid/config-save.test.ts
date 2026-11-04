import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A one-row app_users table that understands the filters saveAutobidConfig
 * uses (id, autobid_config IS NULL, autobid_config->>version). `beforeWrite`
 * lets a test slip another save in between the read and the write.
 */
const db = vi.hoisted(() => ({
  row: { id: "u1", autobid_config: null as Record<string, unknown> | null },
  beforeWrite: null as null | (() => void),
  writes: 0,
}));

vi.mock("@/lib/supabase/admin", () => {
  function query() {
    const filters: Array<(row: typeof db.row) => boolean> = [];
    let patch: Record<string, unknown> | null = null;
    const builder = {
      select() {
        return builder;
      },
      update(values: Record<string, unknown>) {
        patch = values;
        return builder;
      },
      eq(column: string, value: string) {
        if (column === "autobid_config->>version") {
          filters.push((row) => row.autobid_config !== null && String(row.autobid_config.version) === value);
        } else {
          filters.push((row) => String((row as Record<string, unknown>)[column]) === value);
        }
        return builder;
      },
      is(column: string, value: null) {
        filters.push((row) => (row as Record<string, unknown>)[column] === value);
        return builder;
      },
      async maybeSingle() {
        return { data: filters.every((f) => f(db.row)) ? { ...db.row } : null, error: null };
      },
      then(resolve: (result: { data: unknown; error: null }) => void) {
        // Awaited after update(...).eq(...).select("id").
        if (patch) {
          if (db.beforeWrite) {
            const slip = db.beforeWrite;
            db.beforeWrite = null;
            slip();
          }
          const match = filters.every((f) => f(db.row));
          if (match) {
            db.row = { ...db.row, ...(patch as { autobid_config: Record<string, unknown> }) };
            db.writes += 1;
          }
          resolve({ data: match ? [{ id: db.row.id }] : [], error: null });
        } else {
          resolve({ data: [db.row], error: null });
        }
      },
    };
    return builder;
  }
  return { getSupabaseAdminClient: () => ({ from: () => query() }) };
});

import { saveAutobidConfig } from "@/lib/autobid/config";

beforeEach(() => {
  db.row = { id: "u1", autobid_config: null };
  db.beforeWrite = null;
  db.writes = 0;
});

describe("saveAutobidConfig", () => {
  it("saves the first setup as version 1, then 2", async () => {
    const first = await saveAutobidConfig("u1", { windows: 3 }, "web");
    expect("config" in first && first.config.version).toBe(1);
    const second = await saveAutobidConfig("u1", { dailyLimit: 10 }, "panel");
    expect("config" in second && second.config).toMatchObject({ version: 2, windows: 3, dailyLimit: 10, updatedBy: "panel" });
  });

  it("never gives two colliding saves the same version: the later one is merged onto the earlier", async () => {
    await saveAutobidConfig("u1", { profileId: 1, profileName: "Donald", running: true }, "web");
    // The website's Stop lands between the panel's read and its write.
    db.beforeWrite = () => {
      db.row = {
        ...db.row,
        autobid_config: { ...db.row.autobid_config, running: false, version: 2, updatedBy: "web" },
      };
    };
    const panel = await saveAutobidConfig("u1", { windows: 4 }, "panel");
    expect("config" in panel && panel.config).toMatchObject({ version: 3, windows: 4, running: false });
    expect(db.row.autobid_config).toMatchObject({ version: 3, windows: 4, running: false });
  });

  it("ignores an old panel's refusal to start, so it cannot stop the run", async () => {
    await saveAutobidConfig("u1", { profileId: 1, profileName: "Donald", running: true }, "web");
    const refusal = await saveAutobidConfig(
      "u1",
      { running: false, note: "Not started: Another JobStrike panel is open (another Chrome profile or computer, e.g. the VPS) and would apply too." },
      "panel",
    );
    expect("config" in refusal && refusal.config).toMatchObject({ running: true, version: 1 });
    expect(db.row.autobid_config).toMatchObject({ running: true, version: 1 });
    // Nor a panel that cannot work itself (AI off, not signed in).
    const aiOff = await saveAutobidConfig(
      "u1",
      { running: false, note: "Not started: AI answers are off in this panel. Turn on Settings → Autofill with AI, with an OpenAI key, then press Start." },
      "panel",
    );
    expect("config" in aiOff && aiOff.config).toMatchObject({ running: true, version: 1 });
    // Any other stop from a panel (a dry run done) still stops it.
    const done = await saveAutobidConfig("u1", { running: false, note: "Dry run done" }, "panel");
    expect("config" in done && done.config).toMatchObject({ running: false, version: 2 });
  });

  it("returns the merge error without writing", async () => {
    const result = await saveAutobidConfig("u1", { running: true }, "web");
    expect(result).toEqual({ error: "Choose a profile before starting." });
    expect(db.writes).toBe(0);
  });
});
