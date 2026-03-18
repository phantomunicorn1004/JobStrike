import { parseResume } from "./parseResume";
import { parseDOCXStructure } from "./structure/docxParser";
import { parseDOCXWithFormat } from "./structure/docxParserWithFormat";
import { inferStructureFromText } from "./structure/infer";
import { structureToContent } from "./structure/infer";
import { rebuildResume } from "./rebuild";
import { buildDOCXWithPreservedFormat } from "./rebuild/docxFormatPreserver";
import { tailorResumeWithOpenAI } from "../resumeTailor";
import { applyScopedTailoring } from "./tailor/scopedTailor";
import type { ResumeStructure } from "./structure/types";
import type { ResumeContent } from "../resumeTemplates/types";
import { getSkillsAsArray } from "../resumeTemplates/types";

export interface TailorResumePipelineInput {
  file: File | { name: string; arrayBuffer: () => Promise<ArrayBuffer>; size: number; type?: string };
  jobTitle: string;
  jobDescription: string;
  /** Optional override for OpenAI API key (e.g. from workflow Tailor AI node). */
  openaiApiKey?: string;
  /** Optional model (default gpt-4o-mini). */
  model?: string;
}

export interface TailorResumePipelineOutput {
  tailoredText: string;
  tailoredContent: ResumeContent;
  structure: ResumeStructure;
  // Format preservation metadata (for DOCX files)
  originalDocxBuffer?: Buffer;
  docxParagraphsWithFormat?: any[];
  // Files are generated only after preview acceptance
  docxBuffer?: Buffer;
  pdfBuffer?: Buffer;
}

/**
 * Complete structure-preserving resume tailoring pipeline
 * 
 * 1. Parse original resume (PDF or DOCX)
 * 2. Infer/extract structure
 * 3. Tailor content with AI
 * 4. Rebuild resume preserving structure
 * 5. Return tailored resume file
 */
export async function tailorResumeWithStructure(
  input: TailorResumePipelineInput
): Promise<TailorResumePipelineOutput> {
  // Validate input parameters
  if (!input.file) {
    throw new Error("Missing required parameter: file");
  }
  if (!input.jobTitle || !input.jobTitle.trim()) {
    throw new Error("Missing required parameter: jobTitle");
  }
  if (!input.jobDescription || !input.jobDescription.trim()) {
    throw new Error("Missing required parameter: jobDescription");
  }

  // Step 1: Parse resume file
  const parseResult = await parseResume(input.file);
  const fileType = parseResult.fileType;

  // Step 2: Extract structure
  let structure: ResumeStructure;
  let originalContent: ResumeContent;

  // Store original buffer for format preservation
  let originalDocxBuffer: Buffer | undefined;
  let docxParagraphsWithFormat: any[] | undefined;

  if (fileType === "docx") {
    // DOCX: Parse structure with formatting metadata for preservation
    const arrayBuffer = await input.file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    originalDocxBuffer = buffer;
    
    // Parse with format preservation metadata
    const docxWithFormat = await parseDOCXWithFormat(buffer);
    docxParagraphsWithFormat = docxWithFormat.paragraphs;
    structure = docxWithFormat.structure;
    
    // Also parse structure for content extraction
    const docxStructure = await parseDOCXStructure(buffer);
    const contentFromStructure = structureToContent(docxStructure.structure);
    
    // Validate experience was parsed
    if (!contentFromStructure.experience || contentFromStructure.experience.length === 0) {
      throw new Error("Failed to parse work experience from resume. Please ensure your resume contains a work experience section.");
    }
    
    originalContent = {
      profileTitle: contentFromStructure.profileTitle,
      professionalSummary: contentFromStructure.professionalSummary || "",
      experience: contentFromStructure.experience,
      contactInfo: contentFromStructure.contactInfo,
      skills: contentFromStructure.skills,
      education: contentFromStructure.education,
      certifications: contentFromStructure.certifications,
    };
  } else {
    // PDF: Infer structure from text
    structure = inferStructureFromText(parseResult.text);
    const contentFromStructure = structureToContent(structure);
    
    // Validate experience was parsed
    if (!contentFromStructure.experience || contentFromStructure.experience.length === 0) {
      throw new Error("Failed to parse work experience from resume. Please ensure your resume contains a work experience section.");
    }
    
    originalContent = {
      profileTitle: contentFromStructure.profileTitle,
      professionalSummary: contentFromStructure.professionalSummary || "",
      experience: contentFromStructure.experience,
      contactInfo: contentFromStructure.contactInfo,
      skills: contentFromStructure.skills,
      education: contentFromStructure.education,
      certifications: contentFromStructure.certifications,
    };
    
    // Mark as PDF-originated
    structure.originalFormat = {
      fileType: "pdf",
    };
  }

  // Step 3: Tailor content with AI
  const tailoredResponse = await tailorResumeWithOpenAI({
    jobTitle: input.jobTitle,
    jobDescription: input.jobDescription,
    resumeText: parseResult.text,
    ...(input.openaiApiKey?.trim() && { openaiApiKey: input.openaiApiKey.trim() }),
    ...(input.model?.trim() && { model: input.model.trim() }),
  });

  // Validate AI response
  if (!tailoredResponse) {
    throw new Error("AI tailoring failed: no response received");
  }
  if (!tailoredResponse.profile_title || !tailoredResponse.profile_title.trim()) {
    throw new Error("AI tailoring failed: missing profile title in response");
  }

  // Step 4: Apply scoped tailoring - only improve allowed sections
  const tailoredContent = applyScopedTailoring(
    structure,
    tailoredResponse,
    originalContent
  );

  // Validate tailored content
  if (!tailoredContent.profileTitle || !tailoredContent.profileTitle.trim()) {
    throw new Error("Tailored content validation failed: profile title is required");
  }
  if (!tailoredContent.experience || !Array.isArray(tailoredContent.experience) || tailoredContent.experience.length === 0) {
    throw new Error("Tailored content validation failed: experience array is required and cannot be empty");
  }

  // Step 5: Format tailored text for ATS checking
  // Files are NOT generated here - only after preview acceptance
  const tailoredText = formatTailoredResumeText(tailoredContent);

  return {
    tailoredText,
    tailoredContent,
    structure,
    // Format preservation metadata for DOCX files
    originalDocxBuffer,
    docxParagraphsWithFormat,
    // Files will be generated after preview acceptance
  };
}

/**
 * Generate DOCX and PDF files from tailored resume content
 * Called after user accepts the preview
 * 
 * For DOCX files, uses format-preserving rebuild if original buffer is available
 */
export async function generateResumeFiles(
  structure: ResumeStructure,
  tailoredContent: ResumeContent,
  formatMetadata?: {
    originalDocxBuffer?: Buffer;
    docxParagraphsWithFormat?: any[];
  }
): Promise<{ docxBuffer: Buffer; pdfBuffer: Buffer }> {
  // Validate required parameters
  if (!structure) {
    throw new Error("Missing required parameter: structure");
  }
  if (!tailoredContent) {
    throw new Error("Missing required parameter: tailoredContent");
  }
  if (!tailoredContent.profileTitle || !tailoredContent.profileTitle.trim()) {
    throw new Error("Invalid tailoredContent: profileTitle is required");
  }
  if (!structure.sections || !Array.isArray(structure.sections)) {
    throw new Error("Invalid structure: sections array is required");
  }

  // Generate DOCX - use format-preserving if original buffer available
  let docxBuffer: Buffer;
  
  if (formatMetadata?.originalDocxBuffer && formatMetadata?.docxParagraphsWithFormat) {
    // FORMAT-PRESERVING: Use original DOCX buffer and paragraph metadata
    docxBuffer = await buildDOCXWithPreservedFormat(
      formatMetadata.originalDocxBuffer,
      formatMetadata.docxParagraphsWithFormat,
      tailoredContent
    );
    
    // Validate format-preserved DOCX buffer
    if (!docxBuffer || !Buffer.isBuffer(docxBuffer) || docxBuffer.length === 0) {
      throw new Error("Format-preserving DOCX generation failed: invalid or empty buffer");
    }
  } else {
    // FALLBACK: Standard rebuild (for PDF input or when format metadata unavailable)
    const docxResult = await rebuildResume(structure, tailoredContent, { outputFormat: "docx" });
    docxBuffer = docxResult.buffer;
    
    // Validate DOCX buffer
    if (!docxBuffer || !Buffer.isBuffer(docxBuffer) || docxBuffer.length === 0) {
      throw new Error("DOCX generation failed: invalid or empty buffer");
    }
  }

  // Generate PDF from the same tailored content
  // Note: For true format preservation, PDF should be converted from DOCX
  // Currently using PDF generator as fallback
  const pdfResult = await rebuildResume(structure, tailoredContent, { outputFormat: "pdf" });

  // Validate PDF buffer
  if (!pdfResult.buffer || !Buffer.isBuffer(pdfResult.buffer) || pdfResult.buffer.length === 0) {
    throw new Error("PDF generation failed: invalid or empty buffer");
  }

  return {
    docxBuffer,
    pdfBuffer: pdfResult.buffer,
  };
}

/**
 * Format tailored content back to plain text for ATS checking
 */
function formatTailoredResumeText(content: ResumeContent): string {
  let text = `${content.profileTitle}\n\n`;
  
  if (content.contactInfo) {
    text += `${content.contactInfo}\n\n`;
  }
  
  if (content.professionalSummary) {
    text += `PROFESSIONAL SUMMARY\n${content.professionalSummary}\n\n`;
  }
  
  if (content.experience && content.experience.length > 0) {
    text += `EXPERIENCE\n`;
    content.experience.forEach((exp) => {
      text += `${exp.jobTitle} | ${exp.company}\n`;
      exp.bullets.forEach((bullet) => {
        text += `• ${bullet}\n`;
      });
      text += `\n`;
    });
  }
  
  const skillsArr = getSkillsAsArray(content.skills);
  if (skillsArr.length > 0) {
    text += `TECHNICAL SKILLS\n${skillsArr.join(" • ")}\n\n`;
  }
  
  if (content.education && content.education.length > 0) {
    text += `EDUCATION\n${content.education.join("\n")}\n\n`;
  }
  
  if (content.certifications && content.certifications.length > 0) {
    text += `CERTIFICATIONS\n${content.certifications.join("\n")}\n`;
  }
  
  return text.trim();
}

/** Input for tailoring when resume is already parsed (e.g. from ResumeDB). */
export interface TailorFromContentInput {
  content: ResumeContent;
  structure: ResumeStructure;
  jobTitle: string;
  jobDescription: string;
  openaiApiKey?: string;
  model?: string;
}

/**
 * Tailor an already-parsed resume (e.g. from ResumeDB). Skips file parse; uses content + structure directly.
 */
export async function tailorResumeFromContent(
  input: TailorFromContentInput
): Promise<Omit<TailorResumePipelineOutput, "originalDocxBuffer" | "docxParagraphsWithFormat">> {
  if (!input.content?.profileTitle?.trim()) {
    throw new Error("Invalid content: profileTitle is required");
  }
  if (!input.structure?.sections?.length) {
    throw new Error("Invalid structure: sections are required");
  }
  if (!input.jobTitle?.trim() || !input.jobDescription?.trim()) {
    throw new Error("jobTitle and jobDescription are required");
  }

  const resumeText = formatTailoredResumeText(input.content);

  const tailoredResponse = await tailorResumeWithOpenAI({
    jobTitle: input.jobTitle,
    jobDescription: input.jobDescription,
    resumeText,
    ...(input.openaiApiKey?.trim() && { openaiApiKey: input.openaiApiKey.trim() }),
    ...(input.model?.trim() && { model: input.model.trim() }),
  });

  if (!tailoredResponse?.profile_title?.trim()) {
    throw new Error("AI tailoring failed: missing profile title in response");
  }

  const tailoredContent = applyScopedTailoring(
    input.structure,
    tailoredResponse,
    input.content
  );

  if (!tailoredContent.profileTitle?.trim() || !tailoredContent.experience?.length) {
    throw new Error("Tailored content validation failed");
  }

  const tailoredText = formatTailoredResumeText(tailoredContent);

  return {
    tailoredText,
    tailoredContent,
    structure: input.structure,
  };
}
