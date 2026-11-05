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
