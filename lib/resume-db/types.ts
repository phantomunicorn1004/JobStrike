export type ResumeDbApplication = {
  id: number;
  entryId: string;
  profileId: number | null;
  candidateName: string;
  jobLink: string;
  jobTitle: string;
  company: string;
  apply: string;
  resumeUrl: string;
  coverLetterUrl: string;
  appliedAt: string;
  createdAt: string;
  pipelineJobId: number | null;
  resumeStoragePath?: string | null;
  coverLetterStoragePath?: string | null;
};

export type ResumeDbApplicationInput = {
  entryId: string;
  profileId?: number | null;
  candidateName: string;
  jobLink: string;
  jobTitle: string;
  company: string;
  apply?: string;
  resumeUrl: string;
  coverLetterUrl?: string;
  resumeStoragePath?: string;
  coverLetterStoragePath?: string;
  pipelineJobId?: number | null;
};

export type ResumeDbJobExport = {
  entryId: string;
  id: number;
  profileId: number | null;
  candidateName: string;
  jobLink: string;
  jobTitle: string;
  company: string;
  resumeUrl: string;
  coverLetterUrl: string;
  apply: string;
  appliedAt: string;
  exportedAt: string;
};

export type ProfileListItem = {
  id: number;
  full_name: string;
};
