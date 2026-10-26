import { describe, expect, it } from "vitest";
import { planMove, resolveStageRoles, type StageRoles } from "@/lib/mail/board-rules";
import type { MailCategory } from "@/lib/mail/categories";

// The live board: Screening (id "applied"), HR, Technical, Final, Reject.
const board = resolveStageRoles([
  { id: "applied", name: "Screening", sort_order: 0 },
  { id: "hr--manager", name: "HR", sort_order: 1 },
  { id: "technical", name: "Technical", sort_order: 2 },
  { id: "final", name: "Final", sort_order: 3 },
  { id: "reject", name: "Reject", sort_order: 4 },
]);
// The default board: no HR column, no Reject column.
const defaults = resolveStageRoles([
  { id: "applied", name: "Applied", sort_order: 0 },
  { id: "technical", name: "Technical", sort_order: 1 },
  { id: "final", name: "Final", sort_order: 2 },
]);

const move = (
  category: MailCategory,
  currentStage: string | null,
  extra: { interviewStage?: string | null; text?: string } = {},
  roles: StageRoles = board,
) =>
  planMove({
    category,
    interviewStage: extra.interviewStage ?? null,
    text: extra.text ?? "",
    currentStage,
    roles,
    company: "Aflac",
    receivedAt: "2026-10-14T12:00:00Z",
  })?.toStage ?? null;

describe("board moves from emails", () => {
  it("finds the columns by name", () => {
    expect(board).toMatchObject({ screening: "applied", hr: "hr--manager", technical: "technical", final: "final", reject: "reject" });
  });

  it.each([
    ["rejection from Registered", move("rejection", null), "reject"],
    ["rejection from Technical", move("rejection", "technical"), "reject"],
    ["rejection when already rejected", move("rejection", "reject"), null],
    ["recruiter screening", move("interview", null, { interviewStage: "screening" }), "applied"],
    ["older 'screen' value", move("interview", null, { interviewStage: "screen" }), "applied"],
    ["AI screening goes to Screening", move("interview", null, { interviewStage: "ai_screening" }), "applied"],
    ["HR interview", move("interview", "applied", { interviewStage: "hr" }), "hr--manager"],
    ["HireVue wording", move("interview", null, { text: "Complete your HireVue video interview" }), "applied"],
    ["coding test", move("assessment", "applied", { interviewStage: "technical" }), "technical"],
    ["an assessment never jumps to Final", move("assessment", null, { interviewStage: "final" }), "technical"],
    ["technical after HR", move("interview", "hr--manager", { interviewStage: "technical" }), "technical"],
    ["no step back", move("interview", "technical", { interviewStage: "screening" }), null],
    ["final by wording", move("interview", "technical", { text: "Invitation to your final round onsite" }), "final"],
    ["nothing leaves Reject", move("interview", "reject", { interviewStage: "final" }), null],
    ["offer", move("offer", "technical"), "final"],
    ["application received moves nothing", move("confirmation", null), null],
    ["status update moves nothing", move("update", "applied"), null],
    ["unknown custom column is left alone", move("interview", "custom-col", { interviewStage: "final" }), null],
    ["no Reject column on the default board", move("rejection", "applied", {}, defaults), null],
    ["screening on the default board", move("interview", null, { interviewStage: "screening" }, defaults), "applied"],
  ])("%s", (_name, got, want) => {
    expect(got).toBe(want);
  });
});
