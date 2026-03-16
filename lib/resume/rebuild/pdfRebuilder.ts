import type { ResumeStructure } from "../structure/types";
import type { ResumeContent } from "../../resumeTemplates/types";
import { renderToBuffer } from "@react-pdf/renderer";
import { generatePDFDocument } from "../../fileGenerators/pdfGenerator";
import { TEMPLATE_CONFIGS } from "../../resumeTemplates/types";

/**
 * Rebuild PDF from structure and tailored content
 * 
 * CRITICAL FORMAT PRESERVATION NOTE:
 * For true format preservation, PDF should be generated FROM the modified DOCX file.
 * This would require:
 * 1. Generating format-preserved DOCX first
 * 2. Converting DOCX → PDF using a service (LibreOffice, CloudConvert, or similar)
 * 
 * Current implementation generates PDF from content directly for compatibility,
 * which may not preserve exact formatting. For production, implement DOCX → PDF conversion.
 * 
 * The DOCX buffer should already exist before calling this function.
 */
export async function rebuildPDFFromStructure(
  structure: ResumeStructure,
  tailoredContent: ResumeContent
): Promise<Buffer> {
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

  // Generate PDF using the existing PDF generator
  const templateConfig = TEMPLATE_CONFIGS.modern;
  const pdfDoc = generatePDFDocument(tailoredContent, templateConfig);
  const pdfBuffer = await renderToBuffer(pdfDoc);
  
  if (!pdfBuffer || pdfBuffer.length === 0) {
    throw new Error("PDF generation failed: empty buffer");
  }
  
  return Buffer.from(pdfBuffer);
}
