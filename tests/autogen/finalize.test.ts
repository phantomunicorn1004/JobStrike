import { describe, expect, it } from "vitest";
import { coverLetterDate, finalizeBuiltResume } from "@/lib/autogen/finalize";
import { TARGET, makeAnswer, makeKit } from "./fixtures";

const TODAY = "October 29, 2026";

function run(answer: unknown, kit = makeKit(), target = TARGET) {
  return finalizeBuiltResume({ built: answer, kit, target, todayText: TODAY });
}

describe("finalizeBuiltResume", () => {
  it("accepts a well-formed answer unchanged apart from the target fields", () => {
    const result = run(makeAnswer());
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.restored).toEqual([]);
    const resume = result.resume as any;
    expect(resume.summary.text).toBe("Platform engineer with Kubernetes and Python depth.");
    expect(resume.cover_letter.today_date.text).toBe(TODAY);
  });

  it("puts back employers, titles, locations, arrangements and dates the model changed", () => {
    const answer = makeAnswer() as any;
    answer.work_experience.experience_1.company.text = "Google";
    answer.work_experience.experience_1.role_title.text = "Staff Platform Engineer";
    answer.work_experience.experience_1.location.text = "Mountain View, CA";
    answer.work_experience.experience_2.work_arrangement.text = "Remote";
    answer.work_experience.experience_2.end_date = "Present";
    const result = run(answer);
    expect(result.ok).toBe(true);
    const role1 = (result.resume as any).work_experience.experience_1;
    expect(role1.company.text).toBe("Acme Corp");
    expect(role1.role_title.text).toBe("Senior Engineer");
    expect(role1.location.text).toBe("Austin, TX");
    expect((result.resume as any).work_experience.experience_2.work_arrangement.text).toBe("Hybrid");
    expect(result.restored).toEqual([
      "work_experience.experience_1.company",
      "work_experience.experience_1.location",
      "work_experience.experience_1.role_title",
      "work_experience.experience_2.work_arrangement",
      "work_experience.experience_2.end_date",
    ]);
  });

  it("puts back contact details and education", () => {
    const answer = makeAnswer() as any;
    answer.email = "other@example.com";
    answer.education.degree = "PhD Computer Science";
    answer.current_location = "Remote";
    const result = run(answer);
    const resume = result.resume as any;
    expect(resume.email).toBe("sam@example.com");
    expect(resume.education.degree).toBe("BS Computer Science");
    expect(resume.current_location).toBe("Austin, TX");
    expect(result.restored).toEqual(expect.arrayContaining(["email", "education", "current_location"]));
  });

  it("restores role facts the answer left out", () => {
    const answer = makeAnswer() as any;
    delete answer.work_experience.experience_2.company;
    const result = run(answer);
    expect(result.ok).toBe(true);
    expect((result.resume as any).work_experience.experience_2.company.text).toBe("Globex");
  });

  it("uses the registered job, not the model's reading of it", () => {
    const answer = makeAnswer() as any;
    answer.company_name = "Initech Inc (from JD)";
    answer.job_title = "";
    const result = run(answer);
    expect(result.ok).toBe(true);
    expect((result.resume as any).company_name).toBe("Initech");
    expect((result.resume as any).job_title).toBe("Staff Platform Engineer");
    expect((result.resume as any).job_description).toBe("Build platforms.");
  });

  it("rejects a missing or empty placeholder", () => {
    const answer = makeAnswer() as any;
    delete answer.work_experience.experience_1.bullets.bullet_3;
    answer.summary.text = " ";
    const result = run(answer);
    expect(result.ok).toBe(false);
    expect(result.resume).toBeNull();
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining("<<Bullet-1-3>> is missing"), "<<Summary>> is empty."]),
    );
  });

  it("rejects text that still holds a placeholder", () => {
    const answer = makeAnswer() as any;
    answer.cover_letter.cover_letter_text.text = "Dear <<Recipient-Name>>, …";
    expect(run(answer).errors).toEqual(["<<Cover-Letter-Text>> still contains an unfilled placeholder."]);
  });

  it("rejects a missing role", () => {
    const answer = makeAnswer() as any;
    delete answer.work_experience.experience_2;
    expect(run(answer).errors).toContain("The answer has no work_experience.experience_2.");
  });

  it("drops bold words that are not in their text, and duplicates", () => {
    const answer = makeAnswer() as any;
    answer.summary.bold_words = ["Kubernetes", "kubernetes", "Rust", "Python", "Python", ""];
    const result = run(answer);
    expect((result.resume as any).summary.bold_words).toEqual(["Kubernetes", "Python"]);
    expect(result.warnings).toContain("Dropped 4 bold word(s) not found in their text.");
  });

  it("removes roles the kit does not have", () => {
    const answer = makeAnswer() as any;
    answer.work_experience.experience_3 = { company: "Invented LLC" };
    const result = run(answer);
    expect(result.ok).toBe(true);
    expect((result.resume as any).work_experience.experience_3).toBeUndefined();
  });

  it("refuses to run on a kit with a blank employer", () => {
    const kit = makeKit() as any;
    kit.work_experience.experience_1.company.text = "";
    const result = run(makeAnswer(), kit);
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatch(/^Kit: work_experience\.experience_1\.company is blank/);
  });

  it("rejects a non-object answer", () => {
    expect(run(["not", "an", "object"]).errors).toEqual(["The answer is not a JSON object."]);
  });

  it("does not modify the model's object", () => {
    const answer = makeAnswer() as any;
    answer.work_experience.experience_1.company.text = "Google";
    run(answer);
    expect(answer.work_experience.experience_1.company.text).toBe("Google");
  });
});

describe("coverLetterDate", () => {
  it("formats the date in the user's time zone", () => {
    const instant = new Date("2026-10-30T02:00:00Z");
    expect(coverLetterDate("America/Los_Angeles", instant)).toBe("October 29, 2026");
    expect(coverLetterDate("Asia/Tokyo", instant)).toBe("October 30, 2026");
  });
});
