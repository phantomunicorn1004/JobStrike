import { describe, expect, it } from "vitest";
import {
  DEFAULT_AUTOBID_CONFIG,
  mergeAutobidConfig,
  toAutobidConfig,
  validHours,
} from "@/lib/autobid/config-shape";

describe("mergeAutobidConfig", () => {
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
