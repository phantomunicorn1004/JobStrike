export type TemplateId = "modern" | "classic" | "creative" | "minimal";

export type ResumeContent = {
  profileTitle: string;
  professionalSummary: string;
  experience: Array<{
    jobTitle: string;
    company: string;
    bullets: string[];
  }>;
  contactInfo?: string;
  skills?: string[];
  education?: string[];
  certifications?: string[];
};

export type TemplateConfig = {
  id: TemplateId;
  name: string;
  description: string;
  // Template-specific styling options
  fontSize: {
    title: number;
    heading: number;
    body: number;
  };
  spacing: {
    section: number;
    item: number;
  };
  alignment: "left" | "center";
};

export const TEMPLATE_CONFIGS: Record<TemplateId, TemplateConfig> = {
  modern: {
    id: "modern",
    name: "Modern",
    description: "Clean and contemporary design",
    fontSize: { title: 24, heading: 16, body: 11 },
    spacing: { section: 16, item: 8 },
    alignment: "left",
  },
  classic: {
    id: "classic",
    name: "Classic",
    description: "Traditional professional format",
    fontSize: { title: 22, heading: 14, body: 10 },
    spacing: { section: 14, item: 6 },
    alignment: "left",
  },
  creative: {
    id: "creative",
    name: "Creative",
    description: "Bold and eye-catching layout",
    fontSize: { title: 26, heading: 18, body: 11 },
    spacing: { section: 18, item: 10 },
    alignment: "left",
  },
  minimal: {
    id: "minimal",
    name: "Minimal",
    description: "Simple and elegant design",
    fontSize: { title: 20, heading: 14, body: 10 },
    spacing: { section: 12, item: 6 },
    alignment: "left",
  },
};
