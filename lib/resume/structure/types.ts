export type SectionType =
  | "header"
  | "summary"
  | "experience"
  | "skills"
  | "education"
  | "certifications"
  | "other";

export interface ResumeSection {
  type: SectionType;
  title?: string;
  content: string[];
  order: number;
  metadata?: {
    isHeading?: boolean;
    isBulletList?: boolean;
    originalFormatting?: any;
  };
}

export interface ResumeStructure {
  header: {
    title?: string;
    contactInfo?: string[];
  };
  sections: ResumeSection[];
  originalFormat?: {
    fileType: "pdf" | "docx";
    styles?: Record<string, any>;
  };
}

export interface StructuredResumeContent {
  profileTitle: string;
  contactInfo?: string;
  professionalSummary?: string;
  experience: Array<{
    jobTitle: string;
    company: string;
    bullets: string[];
  }>;
  skills?: string[];
  education?: string[];
  certifications?: string[];
  structure: ResumeStructure;
}
