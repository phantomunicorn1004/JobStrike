import mammoth from "mammoth";
import type { ResumeStructure } from "./types";

/**
 * Parse DOCX file preserving formatting metadata
 * This is used to map tailored content back to original paragraphs
 */
export interface ParagraphWithFormat {
  text: string;
  index: number;
  isHeading: boolean;
  isBullet: boolean;
  sectionType?: "header" | "summary" | "experience" | "skills" | "education" | "certifications" | "other";
  indentLevel?: number;
  originalSpacing?: {
    before?: number;
    after?: number;
  };
}

export interface DOCXStructureWithFormat {
  structure: ResumeStructure;
  paragraphs: ParagraphWithFormat[];
  originalBuffer: Buffer;
  paragraphCount: number;
}

/**
 * Parse DOCX and extract both structure and paragraph-level formatting
 * This allows us to map tailored content back to specific paragraphs
 */
export async function parseDOCXWithFormat(buffer: Buffer): Promise<DOCXStructureWithFormat> {
  try {
    // Extract text with formatting hints
    const textResult = await mammoth.extractRawText({ buffer });
    const text = textResult.value.trim();

    // Extract HTML for formatting metadata
    const htmlResult = await mammoth.convertToHtml({ buffer });
    const html = htmlResult.value;

    // Parse structure from text
    const { inferStructureFromText } = await import("./infer");
    const structure = inferStructureFromText(text);

    // Parse paragraphs with formatting metadata
    const paragraphs = parseParagraphsWithFormat(text, html, structure);

    return {
      structure,
      paragraphs,
      originalBuffer: buffer,
      paragraphCount: paragraphs.length,
    };
  } catch (error) {
    throw new Error(
      `Failed to parse DOCX with format: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

/**
 * Parse paragraphs from text and HTML to extract formatting information
 */
function parseParagraphsWithFormat(
  text: string,
  html: string,
  structure: ResumeStructure
): ParagraphWithFormat[] {
  const lines = text.split("\n").filter((line) => line.trim().length > 0);
  const paragraphs: ParagraphWithFormat[] = [];

  let currentSectionType: ParagraphWithFormat["sectionType"] = "other";
  let paragraphIndex = 0;
  let isInHeader = true; // First few paragraphs are typically header

  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    // Detect section type based on content
    const upperLine = trimmed.toUpperCase();
    
    // Check if this is a section header
    if (upperLine === trimmed && trimmed.length < 50) {
      if (trimmed.includes("SUMMARY") || trimmed.includes("PROFILE") || trimmed.includes("OBJECTIVE")) {
        currentSectionType = "summary";
        isInHeader = false;
      } else if (trimmed.includes("EXPERIENCE") || trimmed.includes("WORK") || trimmed.includes("EMPLOYMENT")) {
        currentSectionType = "experience";
        isInHeader = false;
      } else if (trimmed.includes("SKILL") || trimmed.includes("TECHNICAL")) {
        currentSectionType = "skills";
        isInHeader = false;
      } else if (trimmed.includes("EDUCATION")) {
        currentSectionType = "education";
        isInHeader = false;
      } else if (trimmed.includes("CERTIFICATION") || trimmed.includes("LICENSE")) {
        currentSectionType = "certifications";
        isInHeader = false;
      }
    }

    // First paragraphs before any section header are in the header
    if (isInHeader) {
      currentSectionType = "header";
    }

    // Detect formatting from HTML hints
    const htmlLines = html.split("\n");
    const htmlLine = htmlLines[paragraphIndex] || "";
    const isHeading = htmlLine.includes("<h") || htmlLine.includes("strong") || (upperLine === trimmed && trimmed.length < 50);
    const isBullet = trimmed.match(/^[•\-\*]\s/) !== null || 
                    trimmed.match(/^[\u2022\u2023\u25E6\u2043]\s/) !== null ||
                    htmlLine.includes("<li>");
    
    // Extract indent level
    const indentMatch = line.match(/^(\s+)/);
    const indentLevel = indentMatch ? Math.floor(indentMatch[1].length / 4) : 0;

    paragraphs.push({
      text: trimmed,
      index: paragraphIndex++,
      isHeading,
      isBullet,
      sectionType: currentSectionType === "other" ? "header" : currentSectionType, // Default to header if not detected
      indentLevel,
      originalSpacing: {
        before: isHeading ? 200 : 0,
        after: isHeading ? 100 : 200,
      },
    });
  });

  return paragraphs;
}
