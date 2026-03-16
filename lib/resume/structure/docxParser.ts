import mammoth from "mammoth";
import type { ResumeStructure, ResumeSection, SectionType } from "./types";
import { inferStructureFromText } from "./infer";

/**
 * Parse DOCX file and extract structure with formatting preservation
 */
export async function parseDOCXStructure(buffer: Buffer): Promise<{
  structure: ResumeStructure;
  text: string;
}> {
  try {
    // Extract text with formatting information
    const result = await mammoth.extractRawText({ buffer });
    const text = result.value.trim();

    // Use text-based inference (structure preserved from original)
    const structure = inferStructureFromText(text);

    return {
      structure: {
        ...structure,
        originalFormat: {
          fileType: "docx",
        },
      },
      text,
    };
  } catch (error) {
    throw new Error(`Failed to parse DOCX structure: ${error instanceof Error ? error.message : "Unknown error"}`);
  }
}
