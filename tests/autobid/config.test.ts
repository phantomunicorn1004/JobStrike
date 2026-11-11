import { describe, expect, it } from "vitest";
import {
  DEFAULT_AUTOBID_CONFIG,
  mergeAutobidConfig,
  toAutobidConfig,
  validHours,
} from "@/lib/autobid/config-shape";

describe("mergeAutobidConfig", () => {
  it("keeps the current number when a field is emptied", () => {
    const current = { ...DEFAULT_AUTOBID_CONFIG, dailyLimit: 40, windows: 3, everyMinutes: 45 };
    const result = mergeAutobidConfig(current, { dailyLimit: "", windows: null, everyMinutes: " " });
    expect("config" in result && result.config).toMatchObject({ dailyLimit: 40, windows: 3, everyMinutes: 45 });
  });

  it("saves the one-job test run mode, and reads older setups as not a test run", () => {
    const result = mergeAutobidConfig(DEFAULT_AUTOBID_CONFIG, { submit: true, once: true });
    expect("config" in result && result.config).toMatchObject({ submit: true, once: true });
    expect(toAutobidConfig({ submit: true, version: 4 }).once).toBe(false);
  });

  it("still clamps an explicit 0 to the minimum", () => {
    const result = mergeAutobidConfig(DEFAULT_AUTOBID_CONFIG, { dailyLimit: 0 });
    expect("config" in result && result.config.dailyLimit).toBe(1);
  });

  it("refuses to start without a profile", () => {
    expect(mergeAutobidConfig(DEFAULT_AUTOBID_CONFIG, { running: true })).toEqual({
      error: "Choose a profile before starting.",
    });
  });

  it("refuses to start with both sources off", () => {
    const result = mergeAutobidConfig(
      { ...DEFAULT_AUTOBID_CONFIG, profileId: 1 },
      { running: true, hiringCafe: false, jobright: false },
    );
    expect(result).toEqual({ error: "Turn on HiringCafe or Jobright before starting." });
  });

  it("starts with a profile, clamps numbers and clears the stop note", () => {
    const result = mergeAutobidConfig(
      { ...DEFAULT_AUTOBID_CONFIG, note: "Dry run done" },
      { running: true, profileId: "3", profileName: "Donald", dailyLimit: 999, windows: 0, everyMinutes: 5, extra: 1 },
    );
    expect("config" in result && result.config).toMatchObject({
      running: true,
      profileId: 3,
      profileName: "Donald",
      dailyLimit: 200,
      windows: 1,
      everyMinutes: 15,
      note: "",
    });
    expect("config" in result && "extra" in result.config).toBe(false);
  });

  it("checks the hours", () => {
    expect(validHours("10:00-20:30, 01:00-07:30")).toBe(true);
    expect(validHours("")).toBe(true);
    expect(validHours("ten to eight")).toBe(false);
    expect(mergeAutobidConfig(DEFAULT_AUTOBID_CONFIG, { hours: "9-5pm" })).toHaveProperty("error");
  });

  it("runs all day on HiringCafe's freshest jobs at a person's pace by default, Ashby on", () => {
    expect(DEFAULT_AUTOBID_CONFIG).toMatchObject({ hours: "", everyMinutes: 15, freshnessHours: 3, ashby: true, gapMin: 1, gapMax: 3 });
  });

  it("clamps freshness and the gap, and keeps the gap range in order", () => {
    const result = mergeAutobidConfig(DEFAULT_AUTOBID_CONFIG, { freshnessHours: 99, gapMin: 8, gapMax: 3, ashby: 0 });
    expect("config" in result && result.config).toMatchObject({ freshnessHours: 24, gapMin: 8, gapMax: 8, ashby: false });
  });

  it("stops even when the setup is incomplete", () => {
    const result = mergeAutobidConfig({ ...DEFAULT_AUTOBID_CONFIG, running: true, profileId: null }, { running: false });
    expect("config" in result && result.config.running).toBe(false);
  });
});

describe("toAutobidConfig", () => {
  it("fills defaults for an empty or old value", () => {
    expect(toAutobidConfig(null)).toEqual(DEFAULT_AUTOBID_CONFIG);
    expect(toAutobidConfig({ dailyLimit: 10 }).dailyLimit).toBe(10);
  });

  it("keeps the version and running state of a complete setup", () => {
    const config = toAutobidConfig({ running: true, profileId: 2, version: 7, updatedBy: "web", updatedAt: "2026-10-31T10:00:00Z" });
    expect(config).toMatchObject({ running: true, profileId: 2, version: 7, updatedBy: "web" });
  });

  it("reads a running setup without a profile as stopped", () => {
    expect(toAutobidConfig({ running: true, version: 3 }).running).toBe(false);
  });
});
