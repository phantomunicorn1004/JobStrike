export type ResumeDbApplication = {
  id: number;
  entryId: string;
  profileId: number | null;
  candidateName: string;
  jobLink: string;
  jobTitle: string;
  company: string;
  note: string;
  apply: string;
  resumeUrl: string;
  coverLetterUrl: string;
  appliedAt: string;
  createdAt: string;
  pipelineJobId: number | null;
  /** Cached pipeline stage; null = Registered (not in pipeline). */
  pipelineStageId?: string | null;
  resumeStoragePath?: string | null;
  coverLetterStoragePath?: string | null;
  resumeDriveFileId?: string | null;
  coverDriveFileId?: string | null;
};

export type ResumeDbApplicationInput = {
  entryId: string;
  profileId?: number | null;
  candidateName: string;
  jobLink: string;
  jobTitle: string;
  company: string;
  note?: string;
  apply?: string;
  resumeUrl: string;
  coverLetterUrl?: string;
  resumeStoragePath?: string;
  coverLetterStoragePath?: string;
  resumeDriveFileId?: string;
  coverDriveFileId?: string;
  pipelineJobId?: number | null;
  pipelineStageId?: string | null;
};

export type ResumeDbJobExport = {
  entryId: string;
  id: number;
  profileId: number | null;
  candidateName: string;
  jobLink: string;
  jobTitle: string;
  company: string;
  note: string;
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
