import { INTERVIEW_ROUNDS, type InterviewRound } from "@/lib/interviews/types";
import type { InterviewFields } from "@/lib/interviews/repository";

const text = (value: unknown, max: number): string | null | undefined => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const s = String(value).trim().slice(0, max);
  return s || null;
};

/**
 * Body of a manual add or edit: { applicationId?, company?, jobTitle?, startsAt?, endsAt?, round?,
 * meetingUrl?, location?, interviewers?, notes?, status? }. Times are ISO strings (the page
 * converts from the user's timezone). Only given fields are returned.
 */
export function parseInterviewBody(body: unknown, requireStart: boolean): { fields: InterviewFields } | { error: string } {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const fields: InterviewFields = {};

  if (b.startsAt !== undefined) {
    const t = Date.parse(String(b.startsAt));
    if (Number.isNaN(t)) return { error: "Enter a valid start time." };
    fields.starts_at = new Date(t).toISOString();
  } else if (requireStart) {
    return { error: "Enter the start time." };
  }
  if (b.endsAt !== undefined) {
    if (b.endsAt === null || b.endsAt === "") fields.ends_at = null;
    else {
      const t = Date.parse(String(b.endsAt));
      if (Number.isNaN(t)) return { error: "Enter a valid end time." };
      fields.ends_at = new Date(t).toISOString();
    }
  }
  if (fields.starts_at && fields.ends_at && fields.ends_at <= fields.starts_at) {
    return { error: "The end must be after the start." };
  }

  if (b.applicationId !== undefined) {
    if (b.applicationId === null || b.applicationId === "") fields.application_id = null;
    else {
      const id = Number(b.applicationId);
      if (!Number.isInteger(id) || id <= 0) return { error: "Unknown application." };
      fields.application_id = id;
    }
  }
  if (b.round !== undefined) {
    if (!INTERVIEW_ROUNDS.includes(b.round as InterviewRound)) return { error: "Unknown round." };
    fields.round = b.round as InterviewRound;
  }
  if (b.status !== undefined) {
    if (!["scheduled", "done", "cancelled"].includes(String(b.status))) return { error: "Unknown status." };
    fields.status = b.status as InterviewFields["status"];
  }
  const url = text(b.meetingUrl, 1000);
  if (url !== undefined) {
    if (url && !/^https?:\/\//i.test(url)) return { error: "The meeting link must start with https://" };
    fields.meeting_url = url;
  }
  const company = text(b.company, 200);
  if (company !== undefined) fields.company = company;
  const jobTitle = text(b.jobTitle, 200);
  if (jobTitle !== undefined) fields.job_title = jobTitle;
  const location = text(b.location, 300);
  if (location !== undefined) fields.location = location;
  const interviewers = text(b.interviewers, 300);
  if (interviewers !== undefined) fields.interviewers = interviewers;
  const notes = text(b.notes, 4000);
  if (notes !== undefined) fields.notes = notes;
  return { fields };
}
