import { describe, expect, it } from "vitest";
import { jobAnswers, mostRecentRole, postedPay, salaryAnswer } from "@/lib/autobid/job-answers";

const RESUME = JSON.stringify({
  work_experience: {
    heading: "EXPERIENCE",
    experience_2: { company: { text: "Acme" }, role_title: { text: "Software Engineer" } },
    experience_1: { company: { text: "SOURCEGRAPH" }, role_title: { text: "Senior Software Engineer" } },
  },
});

describe("mostRecentRole", () => {
  it("takes experience_1, the resume's most recent role", () => {
    expect(mostRecentRole(RESUME)).toEqual({ company: "SOURCEGRAPH", title: "Senior Software Engineer" });
  });

  it("is null for a resume it cannot read", () => {
    expect(mostRecentRole("not json")).toBeNull();
    expect(mostRecentRole(JSON.stringify({ work_experience: {} }))).toBeNull();
  });
});

describe("postedPay", () => {
  it("reads the common ways a yearly range is written", () => {
    expect(postedPay("The base salary range is $150,000 - $180,000 per year.")).toEqual({ min: 150000, max: 180000, unit: "year", symbol: "$" });
    expect(postedPay("Pay: $150K–$180K + equity")).toEqual({ min: 150000, max: 180000, unit: "year", symbol: "$" });
    expect(postedPay("Compensation $150-180k")).toEqual({ min: 150000, max: 180000, unit: "year", symbol: "$" });
    expect(postedPay("USD 120,000 to USD 140,000 annually")).toEqual({ min: 120000, max: 140000, unit: "year", symbol: "$" });
  });

  it("reads 'between $X and $Y'", () => {
    expect(postedPay("The salary range for this position is between $160,000 and $195,000, plus equity.")).toEqual({
      min: 160000,
      max: 195000,
      unit: "year",
      symbol: "$",
    });
  });

  it("reads hourly and monthly ranges", () => {
    expect(postedPay("Rate: $60 - $75/hr, contract")).toEqual({ min: 60, max: 75, unit: "hour", symbol: "$" });
    expect(postedPay("Compensation: $10.4K – $13.9K per month")).toEqual({ min: 10400, max: 13900, unit: "month", symbol: "$" });
  });

  it("reads non-USD currencies", () => {
    expect(postedPay("Salary: £70,000 - £90,000 per year")).toEqual({ min: 70000, max: 90000, unit: "year", symbol: "£" });
    expect(postedPay("Compensation: €80,000 – €100,000")).toEqual({ min: 80000, max: 100000, unit: "year", symbol: "€" });
    expect(postedPay("CA$90,000 - CA$120,000 annually")).toEqual({ min: 90000, max: 120000, unit: "year", symbol: "CA$" });
  });

  it("ignores amounts that are not a pay range", () => {
    expect(postedPay("We raised $20M - $30M in funding.")).toBeNull();
    expect(postedPay("A $1,000 signing bonus.")).toBeNull();
    expect(postedPay("Ages 21 - 65 welcome.")).toBeNull();
    expect(postedPay("")).toBeNull();
  });
});

describe("salaryAnswer", () => {
  it("answers with the low end of the range", () => {
    expect(salaryAnswer({ min: 150000, max: 181000, unit: "year", symbol: "$" })).toBe("$150,000");
    expect(salaryAnswer({ min: 60, max: 75, unit: "hour", symbol: "$" })).toBe("$60 per hour");
    expect(salaryAnswer({ min: 10400, max: 13900, unit: "month", symbol: "$" })).toBe("$10,400 per month");
  });

  it("uses the currency symbol from the posting", () => {
    expect(salaryAnswer({ min: 70000, max: 90000, unit: "year", symbol: "£" })).toBe("£70,000");
    expect(salaryAnswer({ min: 80000, max: 100000, unit: "year", symbol: "€" })).toBe("€80,000");
  });
});

describe("jobAnswers", () => {
  it("combines the resume's role and the posting's pay", () => {
    expect(jobAnswers(RESUME, "Salary range: $150,000 - $180,000")).toEqual({
      currentCompany: "SOURCEGRAPH",
      currentTitle: "Senior Software Engineer",
      desiredSalary: "$150,000",
      salarySource: "posting: $150,000 – $180,000 per year",
    });
  });

  it("leaves out what it cannot work out, so the profile's own answer applies", () => {
    expect(jobAnswers("", "No salary stated.")).toEqual({});
  });
});
