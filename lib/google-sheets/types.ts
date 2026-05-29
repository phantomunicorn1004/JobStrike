/** Column layout for Resume DB Google Sheet (Table4). */
export const RESUME_DB_COLUMNS = [
  "Candidate",
  "Email",
  "Job_link",
  "Apply",
  "Job_title",
  "Company",
  "resume_url",
  "Date",
] as const;

export type ResumeDbColumn = (typeof RESUME_DB_COLUMNS)[number];

/** Normalized row from the sheet. `rowIndex` is the 1-based sheet row number. */
export type ResumeDbEntry = {
  rowIndex: number;
  candidate: string;
  email: string;
  jobLink: string;
  apply: string;
  jobTitle: string;
  company: string;
  resumeUrl: string;
  date: string;
};

export type ResumeDbEntryInput = Omit<ResumeDbEntry, "rowIndex">;
