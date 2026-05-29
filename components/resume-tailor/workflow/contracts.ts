/**
 * Data contracts for the resume-tailoring workflow.
 * Aligns with existing lib types (ResumeContent, TemplateConfig, ATSCheckResponse) where possible.
 */

import type { ResumeContent } from "@/lib/resumeTemplates/types";
import type { ResumeStructure } from "@/lib/resume/structure/types";
import type { TemplateConfig, TemplateId } from "@/lib/resumeTemplates/types";

/** Input collected at the start of the workflow (Initial Input node). */
export interface WorkflowInput {
  jobTitle: string;
  companyName: string;
  jobDescription: string;
  jobLink?: string;
  /** Google Sheet row index from Resume DB. */
  sheetRowIndex?: string;
  templateId?: TemplateId;
  options?: {
    maxPages?: number;
    tone?: string;
    atsMode?: boolean;
    preserveJobOrder?: boolean;
  };
}

/** Resume as structured JSON (project uses ResumeContent + structure). */
export interface ResumeSchema {
  content: ResumeContent;
  structure?: ResumeStructure;
}

/** Normalized job description from JD Parsing node. */
export interface NormalizedJobDescription {
  requiredSkills: string[];
  preferredSkills: string[];
  toolsAndTechnologies: string[];
  responsibilities: string[];
  senioritySignals: string[];
  industryTerms: string[];
  rawText: string;
}

/** ATS analysis (aligned with lib/atsCheck ATSCheckResponse). */
export interface AtsAnalysis {
  score: number;
  matchedKeywords: string[];
  missingKeywords: string[];
  weakKeywords?: string[];
  strengths?: string[];
  risks?: string[];
  improvementNotes?: string[];
}

/** Tailor AI node output. */
export interface TailorOutput {
  atsAnalysis: AtsAnalysis;
  updatedResume: ResumeContent;
}

/** Template definition (uses existing TemplateConfig). */
export type TemplateDefinition = TemplateConfig;

/** View model for PDF/template rendering (section-order and content ready for layout). */
export interface TemplateViewModel {
  profileTitle: string;
  contactInfo?: string;
  professionalSummary?: string;
  experience: Array<{ jobTitle: string; company: string; bullets: string[] }>;
  skills?: string[];
  education?: string[];
  certifications?: string[];
  customSections?: Array<{ title: string; content: string[] }>;
}

/** PDF build node output. */
export interface PdfBuildOutput {
  pdfDataUrl?: string;
  pdfFileName?: string;
  docxDataUrl?: string;
  docxFileName?: string;
}

/** Final workflow execution result (Download node). */
export interface WorkflowExecutionResult {
  pdf?: PdfBuildOutput;
  updatedResume?: ResumeContent;
  atsAnalysis?: AtsAnalysis;
  validationWarnings?: string[];
  validationErrors?: string[];
}
