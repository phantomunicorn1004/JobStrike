import { describe, expect, it } from "vitest";
import {
  BID_STATE_LABELS,
  BID_STATES,
  nextSortState,
  RESUME_DB_SORT_FIRST_DIR,
  RESUME_DB_SORT_KEYS,
  toSortDir,
  toSortKey,
  type ResumeDbSortState,
} from "../../lib/resume-db/types";

const DEFAULT: ResumeDbSortState = { key: null, dir: "asc" };

describe("toSortKey", () => {
  it("keeps the keys the table can sort by", () => {
    for (const key of RESUME_DB_SORT_KEYS) {
      expect(toSortKey(key)).toBe(key);
    }
  });

  it("reads anything else as the default order", () => {
    for (const bad of ["", "   ", "note", "id", "company; drop table", null, undefined, 7]) {
      expect(toSortKey(bad)).toBeNull();
    }
  });

  it("does not accept a key by the wrong case, which would reach the query raw", () => {
    expect(toSortKey("Company")).toBeNull();
    expect(toSortKey("jobtitle")).toBeNull();
  });
});

describe("toSortDir", () => {
  it("only 'desc' means descending", () => {
    expect(toSortDir("desc")).toBe("desc");
    expect(toSortDir("DESC")).toBe("desc");
    expect(toSortDir(" desc ")).toBe("desc");
    for (const asc of ["asc", "", "sideways", null, undefined]) {
      expect(toSortDir(asc)).toBe("asc");
    }
  });
});

describe("nextSortState", () => {
  it("first click uses the direction that reads naturally for the column", () => {
    expect(nextSortState(DEFAULT, "company")).toEqual({ key: "company", dir: "asc" });
    expect(nextSortState(DEFAULT, "jobTitle")).toEqual({ key: "jobTitle", dir: "asc" });
    expect(nextSortState(DEFAULT, "bid")).toEqual({ key: "bid", dir: "asc" });
    // A date column is wanted newest-first, not oldest-first.
    expect(nextSortState(DEFAULT, "applied")).toEqual({ key: "applied", dir: "desc" });
  });

  it("cycles each column in three clicks and lands back on the default", () => {
    for (const key of RESUME_DB_SORT_KEYS) {
      const first = nextSortState(DEFAULT, key);
      expect(first.key).toBe(key);
      expect(first.dir).toBe(RESUME_DB_SORT_FIRST_DIR[key]);

      const second = nextSortState(first, key);
      expect(second.key).toBe(key);
      expect(second.dir).not.toBe(first.dir);

      const third = nextSortState(second, key);
      expect(third.key).toBeNull();
    }
  });

  it("switching columns starts the new column fresh rather than keeping the direction", () => {
    const appliedDesc = nextSortState(DEFAULT, "applied");
    expect(appliedDesc.dir).toBe("desc");
    expect(nextSortState(appliedDesc, "company")).toEqual({ key: "company", dir: "asc" });
  });

  it("never clears a column the user has not already cycled", () => {
    const companyAsc: ResumeDbSortState = { key: "company", dir: "asc" };
    expect(nextSortState(companyAsc, "applied").key).toBe("applied");
  });
});

describe("bid_state ordering", () => {
  /**
   * The Bid column sorts on the raw bid_state text in Postgres but shows labels.
   * That only reads correctly because the labels happen to sort the same way, so
   * pin it: renaming a label without a rank column would silently scramble it.
   */
  it("sorts the labels in the same order as the raw state values", () => {
    const byRaw = [...BID_STATES].sort().map((s) => BID_STATE_LABELS[s]);
    const byLabel = [...byRaw].sort((a, b) => a.localeCompare(b, "en"));
    expect(byRaw).toEqual(byLabel);
  });
});
