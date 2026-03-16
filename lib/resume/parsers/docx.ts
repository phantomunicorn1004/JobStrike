export interface DOCXParseResult {
  text: string;
}

/**
 * Parse DOCX file and extract text content
 * Uses mammoth for reliable Word document parsing
 * 
 * Mammoth requires { buffer: Buffer } for Node.js server-side use
 * The arrayBuffer option is for browser environments only
 */
export async function parseDOCX(buffer: ArrayBuffer | Buffer): Promise<DOCXParseResult> {
  if (!buffer || (buffer instanceof Buffer && buffer.length === 0) || (buffer instanceof ArrayBuffer && buffer.byteLength === 0)) {
    throw new Error("Invalid buffer: buffer is empty or undefined");
  }

  try {
    // Dynamic import to avoid bundling issues
    const mammoth = await import("mammoth");
    
    // Convert ArrayBuffer to Buffer if needed
    // Mammoth requires Buffer for Node.js server-side parsing
    const nodeBuffer = buffer instanceof Buffer 
      ? buffer 
      : Buffer.from(buffer);
    
    if (nodeBuffer.length === 0) {
      throw new Error("Buffer conversion resulted in empty buffer");
    }
    
    // Use { buffer } option for Node.js (not { arrayBuffer })
    const result = await mammoth.default.extractRawText({ buffer: nodeBuffer });
    const text = result.value.trim();

    if (!text) {
      throw new Error("Document appears to be empty or contains no extractable text");
    }

    // Clean up excessive whitespace while preserving structure
    const cleanedText = text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .join("\n");

    return { text: cleanedText };
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes("empty")) {
        throw error;
      }
      if (error.message.includes("Could not find file")) {
        throw new Error("Invalid DOCX file structure. The file may be corrupted or not a valid Word document.");
      }
      if (error.message.includes("not a valid") || error.message.includes("Invalid")) {
        throw new Error("Invalid DOCX file. The file may be corrupted or not a valid Word document.");
      }
      throw new Error(`DOCX parsing failed: ${error.message}`);
    }
    throw new Error("DOCX parsing failed: Unknown error");
  }
}
