export interface PDFParseResult {
  text: string;
  pageCount: number;
}

/**
 * Parse PDF file and extract text content
 * Uses pdf-parse for Vercel-compatible serverless PDF parsing
 * 
 * pdf-parse is a pure JavaScript library with no native dependencies,
 * making it safe for Vercel serverless deployments
 */
export async function parsePDF(buffer: ArrayBuffer | Buffer): Promise<PDFParseResult> {
  if (!buffer || (buffer instanceof Buffer && buffer.length === 0) || (buffer instanceof ArrayBuffer && buffer.byteLength === 0)) {
    throw new Error("Invalid buffer: buffer is empty or undefined");
  }

  try {
    // Dynamic import to avoid bundling issues
    const pdfParse = await import("pdf-parse");
    
    // Convert ArrayBuffer to Buffer if needed
    // pdf-parse requires a Buffer
    const nodeBuffer = buffer instanceof Buffer 
      ? buffer 
      : Buffer.from(buffer);
    
    if (nodeBuffer.length === 0) {
      throw new Error("Buffer conversion resulted in empty buffer");
    }

    // Parse PDF and extract text
    const data = await pdfParse.default(nodeBuffer);
    
    const text = data.text?.trim() || "";
    const pageCount = data.numpages || 0;

    if (!text) {
      throw new Error("Document appears to be empty or contains no extractable text");
    }

    // Normalize text: clean up excessive whitespace while preserving structure
    const normalizedText = text
      .split(/\n+/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .join("\n");

    return {
      text: normalizedText,
      pageCount,
    };
  } catch (error) {
    if (error instanceof Error) {
      // Provide more helpful error messages
      if (error.message.includes("Invalid PDF") || error.message.includes("invalid") || error.message.includes("PDF")) {
        throw new Error("Invalid PDF file. The file may be corrupted or not a valid PDF.");
      }
      if (error.message.includes("Password") || error.message.includes("password")) {
        throw new Error("PDF is password-protected. Please remove the password and try again.");
      }
      if (error.message.includes("empty")) {
        throw error;
      }
      throw new Error(`PDF parsing failed: ${error.message}`);
    }
    throw new Error("PDF parsing failed: Unknown error");
  }
}
