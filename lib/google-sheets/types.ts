/** Default column layout for Resume DB Google Sheet. */
export const RESUME_DB_COLUMNS = [
  "entry_id",
  "Candidate",
  "Email",
  "Job_link",
  "Apply",
  "Job_title",
  "Company",
  "resume_url",
  "cover_letter_url",
  "Date",
] as const;

export type ResumeDbColumn = (typeof RESUME_DB_COLUMNS)[number];

/** Normalized row from the sheet. `rowIndex` is the 1-based sheet row number. */
export type ResumeDbEntry = {
  rowIndex: number;
  entryId: string;
  candidate: string;
  email: string;
  jobLink: string;
  apply: string;
  jobTitle: string;
  company: string;
  resumeUrl: string;
  coverLetterUrl: string;
  date: string;
};

export type ResumeDbEntryInput = Omit<ResumeDbEntry, "rowIndex">;

/** JSON export shape for a single registered job. */
export type ResumeDbJobExport = {
  entryId: string;
  rowIndex: number;
  candidate: string;
  email: string;
  jobLink: string;
  jobTitle: string;
  company: string;
  resumeUrl: string;
  coverLetterUrl: string;
  apply: string;
  date: string;
  exportedAt: string;
};
