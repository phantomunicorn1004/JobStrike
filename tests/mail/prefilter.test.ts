import { describe, expect, it } from "vitest";
import { buildCompanyIndex, prefilterMessage } from "@/lib/mail/prefilter";
import type { FetchedMessage } from "@/lib/mail/types";

const context = {
  accountEmail: "cand@outlook.com",
  companies: buildCompanyIndex(["Aflac Inc", "Ten Mile Square Technologies", "Meta Platforms", "Microsoft", "IBM", "Capital One"]),
};

const mail = (fromEmail: string, subject: string, preview = "", fromName: string | null = null): FetchedMessage => ({
  providerId: "x",
  threadId: null,
  receivedAt: "2026-10-23T00:00:00Z",
  fromName,
  fromEmail,
  toEmail: "cand@outlook.com",
  subject,
  preview,
  webLink: null,
});

describe("prefilter: what the sync keeps", () => {
  it.each([
    ["recruiting software", mail("no-reply@us.greenhouse-mail.io", "Thank you for applying to Acme")],
    ["SmartRecruiters", mail("notifications@smartrecruiters.com", "Your application for Data Engineer")],
    ["Rippling subdomain", mail("recruiting@ats.rippling.com", "Update on your candidacy")],
    ["company domain", mail("jane@tenmilesquare.com", "Quick chat?", "I saw your profile and wanted to talk about the Senior Engineer position")],
    ["company domain, short subject", mail("talent@aflac.com", "Next steps")],
    ["company in sender name", mail("noreply@hire.example.com", "Hello", "", "Capital One Talent Acquisition")],
    ["LinkedIn application update", mail("jobs-noreply@linkedin.com", "Your application was sent to Meta")],
    ["recruiter wording", mail("sarah.k@somestaffing.com", "Interview availability", "Please share your availability for a call")],
    ["rejection wording", mail("hr@unknowncorp.io", "Regarding your application", "Unfortunately we decided to move forward with other candidates")],
  ])("keeps %s", (_name, message) => {
    expect(prefilterMessage(message, context).keep).toBe(true);
  });

  it.each([
    ["LinkedIn job alerts", mail("jobalerts-noreply@linkedin.com", "Data Engineer: 25 new jobs in Remote")],
    ["LinkedIn social", mail("messages-noreply@linkedin.com", "John Doe wants to connect")],
    ["Indeed alerts", mail("alert@indeed.com", "30+ new Software Engineer jobs for you")],
    ["security code", mail("account-security-noreply@accountprotection.microsoft.com", "Microsoft account security code", "Your security code is 123456")],
    ["verification email", mail("noreply@myworkday.com", "Verify your email address", "Click to verify your account")],
    ["own message", mail("cand@outlook.com", "Interview notes", "my own note")],
    ["shopping", mail("deals@amazon.com", "Your order has shipped", "Track your package")],
    ["newsletter", mail("newsletter@medium.com", "Top stories for you", "Kubernetes tips and tricks")],
    ["marketing with job words", mail("promo@udemy.com", "New course: ace your interview", "", "Udemy")],
  ])("drops %s", (_name, message) => {
    expect(prefilterMessage(message, context).keep).toBe(false);
  });

  it("drops senders the user ignores", () => {
    const ignored = { senders: new Set(["talent@aflac.com"]), domains: new Set<string>() };
    expect(prefilterMessage(mail("talent@aflac.com", "Next steps"), { ...context, ignored })).toEqual({ keep: false, reason: "ignored by you" });
  });
});
