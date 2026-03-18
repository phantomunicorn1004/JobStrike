export type TemplateId = "modern" | "classic" | "creative" | "minimal";

/** FlowCV-style skill entry: category label + sub-skills + optional level */
export type SkillEntry = {
  label: string;
  subSkills?: string[];
  level?: string;
};

export type ResumeContent = {
  profileTitle: string;
  professionalSummary: string;
  experience: Array<{
    jobTitle: string;
    company: string;
    location?: string;
    startDate?: string;
    endDate?: string;
    bullets: string[];
  }>;
  contactInfo?: string;
  /** Skills by category: { "Category Name": ["skill1", "skill2", ...] }. Legacy: may be string[] from old data. */
  skills?: Record<string, string[]> | string[];
  /** Structured skills (FlowCV-style). When present, used by editor; serialized into skills object. */
  skillEntries?: SkillEntry[];
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

/** Convert skills (object or legacy array) to a flat string[] for display/export. */
export function getSkillsAsArray(
  skills: Record<string, string[]> | string[] | undefined,
): string[] {
  if (!skills) return [];
  if (Array.isArray(skills)) return skills;
  return Object.entries(skills).flatMap(([label, arr]) =>
    arr?.length ? [label, ...arr] : [label],
  );
}

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
