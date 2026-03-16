import { parsePDF, type PDFParseResult } from "./parsers/pdf";
import { parseDOCX, type DOCXParseResult } from "./parsers/docx";

export type SupportedFileType = "pdf" | "docx";
export type ParseResult = PDFParseResult | DOCXParseResult;

export interface ResumeParseOptions {
  maxFileSize?: number;
  allowedTypes?: SupportedFileType[];
}

const DEFAULT_OPTIONS: Required<ResumeParseOptions> = {
  maxFileSize: 10 * 1024 * 1024, // 10MB
  allowedTypes: ["pdf", "docx"],
};

/**
 * Detect file type from filename or MIME type
 */
export function detectFileType(
  filename: string,
  mimeType?: string
): SupportedFileType | null {
  const extension = filename.split(".").pop()?.toLowerCase();

  if (extension === "pdf" || mimeType === "application/pdf") {
    return "pdf";
  }

  if (
    extension === "docx" ||
    mimeType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return "docx";
  }

  return null;
}

/**
 * Validate file before parsing
 */
export function validateFile(
  file: File | { name: string; size: number; type?: string },
  options: ResumeParseOptions = {}
): { valid: boolean; error?: string } {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const fileType = detectFileType(file.name, file.type);

  if (!fileType) {
    return {
      valid: false,
      error: `Unsupported file type. Please upload a PDF or DOCX file.`,
    };
  }

  if (!opts.allowedTypes.includes(fileType)) {
    return {
      valid: false,
      error: `File type ${fileType.toUpperCase()} is not allowed.`,
    };
  }

  if (file.size > opts.maxFileSize) {
    const maxSizeMB = (opts.maxFileSize / (1024 * 1024)).toFixed(1);
    return {
      valid: false,
      error: `File size exceeds ${maxSizeMB}MB limit.`,
    };
  }

  if (file.size === 0) {
    return {
      valid: false,
      error: "File is empty.",
    };
  }

  return { valid: true };
}

/**
 * Parse resume file (PDF or DOCX) and extract text content
 * This is the main entry point for resume parsing
 */
export async function parseResume(
  file: File | { name: string; arrayBuffer: () => Promise<ArrayBuffer> },
  options: ResumeParseOptions = {}
): Promise<{ text: string; fileType: SupportedFileType }> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  const validation = validateFile(file, opts);
  if (!validation.valid) {
    throw new Error(validation.error || "File validation failed");
  }

  const fileType = detectFileType(file.name);
  if (!fileType) {
    throw new Error("Unable to determine file type");
  }

  const arrayBuffer = await file.arrayBuffer();
  
  if (!arrayBuffer || arrayBuffer.byteLength === 0) {
    throw new Error("File buffer is empty");
  }
  
  let result: ParseResult;

  try {
    if (fileType === "pdf") {
      result = await parsePDF(arrayBuffer);
    } else {
      // Convert ArrayBuffer to Buffer for DOCX parsing
      // DOCX parser requires Buffer for mammoth
      const buffer = Buffer.from(arrayBuffer);
      result = await parseDOCX(buffer);
    }
  } catch (error) {
    const errorMessage =
      error instanceof Error
        ? error.message
        : `Failed to parse ${fileType.toUpperCase()} file`;
    throw new Error(errorMessage);
  }

  if (!result.text || !result.text.trim()) {
    throw new Error(
      "Could not extract text from file. The file may be empty, corrupted, or contain only images."
    );
  }

  return {
    text: result.text,
    fileType,
  };
}
