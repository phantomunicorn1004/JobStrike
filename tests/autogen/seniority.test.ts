import { describe, expect, it } from "vitest";
import {
  detectSeniority,
  computeDates,
  adjustKitForSeniority,
} from "@/lib/autogen/seniority";

describe("detectSeniority", () => {
  it("detects junior/associate/intern", () => {
    expect(detectSeniority("Junior Full Stack Engineer")).toBe("junior");
    expect(detectSeniority("Associate Software Engineer")).toBe("junior");
    expect(detectSeniority("Jr. Developer")).toBe("junior");
    expect(detectSeniority("Software Engineering Intern")).toBe("junior");
    expect(detectSeniority("Entry-Level Data Analyst")).toBe("junior");
  });

  it("detects mid-level (no prefix or II)", () => {
    expect(detectSeniority("Software Engineer")).toBe("mid");
    expect(detectSeniority("Data Analyst")).toBe("mid");
    expect(detectSeniority("Software Engineer II")).toBe("mid");
    expect(detectSeniority("Full Stack Developer")).toBe("mid");
  });

  it("detects senior", () => {
    expect(detectSeniority("Senior Software Engineer")).toBe("senior");
    expect(detectSeniority("Sr. Backend Developer")).toBe("senior");
    expect(detectSeniority("Software Engineer III")).toBe("senior");
  });

  it("detects lead", () => {
    expect(detectSeniority("Lead Gameplay Engineer")).toBe("lead");
    expect(detectSeniority("Engineering Manager")).toBe("lead");
    expect(detectSeniority("Head of Engineering")).toBe("lead");
    expect(detectSeniority("Director of Engineering")).toBe("lead");
  });

  it("detects staff", () => {
    expect(detectSeniority("Staff Software Engineer")).toBe("staff");
    expect(detectSeniority("Staff Product Engineer")).toBe("staff");
  });

  it("detects principal", () => {
    expect(detectSeniority("Principal Engineer")).toBe("principal");
    expect(detectSeniority("Distinguished Engineer")).toBe("principal");
  });
});

describe("computeDates", () => {
  const now = new Date(2026, 10, 1); // Nov 2026

  it("produces 3 roles with no gaps and the right total span", () => {
    for (const seniority of ["junior", "mid", "senior", "lead", "staff", "principal"] as const) {
      const dates = computeDates(seniority, 3, now);
      expect(dates).toHaveLength(3);
      expect(dates[0].end).toBe("Present");
      for (const d of dates) {
        expect(d.start).toMatch(/^[A-Z][a-z]{2} \d{4}$/);
      }
    }
  });

  it("junior spans ~2-3 years", () => {
    const dates = computeDates("junior", 3, now);
    // exp3 start should be roughly 2.5-3 years before Nov 2026
    expect(dates[2].start).toMatch(/20(23|24)/);
  });

  it("principal spans ~12+ years", () => {
    const dates = computeDates("principal", 3, now);
    expect(dates[2].start).toMatch(/201[2-4]/);
  });
});

describe("adjustKitForSeniority", () => {
  const baseKit = {
    schema_version: "2.3",
    resume_template: "Jacob",
    work_experience: {
      experience_1: {
        company: { placeholder: "<<Company-1>>", text: "" },
        role_title: { placeholder: "<<Role-Title-1>>", text: "" },
        start_date: "Oct 2023",
        end_date: "Present",
      },
      experience_2: {
        company: { placeholder: "<<Company-2>>", text: "" },
        role_title: { placeholder: "<<Role-Title-2>>", text: "" },
        start_date: "May 2020",
        end_date: "Sep 2023",
      },
      experience_3: {
        company: { placeholder: "<<Company-3>>", text: "" },
        role_title: { placeholder: "<<Role-Title-3>>", text: "" },
        start_date: "Jul 2018",
        end_date: "Apr 2020",
      },
    },
  };

  it("does not change dates for senior-level titles", () => {
    const json = JSON.stringify(baseKit);
    expect(adjustKitForSeniority(json, "Senior Software Engineer")).toBe(json);
  });

  it("shortens dates for junior titles", () => {
    const result = JSON.parse(adjustKitForSeniority(JSON.stringify(baseKit), "Junior Developer"));
    const exp3 = result.work_experience.experience_3;
    // Junior exp3 should start much later than Jul 2018
    const year = parseInt(exp3.start_date.split(" ")[1], 10);
    expect(year).toBeGreaterThanOrEqual(2023);
  });

  it("lengthens dates for principal titles", () => {
    const result = JSON.parse(adjustKitForSeniority(JSON.stringify(baseKit), "Principal Engineer"));
    const exp3 = result.work_experience.experience_3;
    const year = parseInt(exp3.start_date.split(" ")[1], 10);
    expect(year).toBeLessThanOrEqual(2015);
  });

  it("skips kits with real company names", () => {
    const realKit = JSON.parse(JSON.stringify(baseKit));
    realKit.work_experience.experience_1.company = { placeholder: "<<Company-1>>", text: "SOURCEGRAPH" };
    const json = JSON.stringify(realKit);
    expect(adjustKitForSeniority(json, "Junior Developer")).toBe(json);
  });

  it("handles placeholder-object dates", () => {
    const objDateKit = JSON.parse(JSON.stringify(baseKit));
    objDateKit.work_experience.experience_1.start_date = { text: "Oct 2023" };
    objDateKit.work_experience.experience_1.end_date = { text: "Present" };
    const result = JSON.parse(adjustKitForSeniority(JSON.stringify(objDateKit), "Junior Developer"));
    expect(result.work_experience.experience_1.end_date.text).toBe("Present");
    const year = parseInt(result.work_experience.experience_1.start_date.text.split(" ")[1], 10);
    expect(year).toBeGreaterThanOrEqual(2025);
  });
});
