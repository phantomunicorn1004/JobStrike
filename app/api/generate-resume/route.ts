import { NextRequest, NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { Packer } from "docx";
import { generatePDFDocument } from "@/lib/fileGenerators/pdfGenerator";
import { generateDOCXDocument } from "@/lib/fileGenerators/docxGenerator";
import { parseResumeText } from "@/lib/fileGenerators/resumeParser";
import { TEMPLATE_CONFIGS, type TemplateId } from "@/lib/resumeTemplates/types";

type GenerateResumeRequest = {
  tailoredResumeText: string;
  templateId: TemplateId;
  fileFormat: "pdf" | "docx";
};

export async function POST(request: NextRequest) {
  try {
    const body: GenerateResumeRequest = await request.json();

    // Validate input
    if (!body.tailoredResumeText || !body.templateId || !body.fileFormat) {
      return NextResponse.json(
        {
          error:
            "Missing required fields: tailoredResumeText, templateId, fileFormat",
        },
        { status: 400 }
      );
    }

    // Validate template
    if (!TEMPLATE_CONFIGS[body.templateId]) {
      return NextResponse.json(
        { error: `Invalid template ID: ${body.templateId}` },
        { status: 400 }
      );
    }

    // Parse resume text into structured content
    const resumeContent = parseResumeText(body.tailoredResumeText);
    const templateConfig = TEMPLATE_CONFIGS[body.templateId];

    let fileBuffer: Buffer;
    let fileName: string;
    let mimeType: string;

    if (body.fileFormat === "pdf") {
      // Generate PDF
      const pdfDoc = generatePDFDocument(resumeContent, templateConfig);
      fileBuffer = await renderToBuffer(pdfDoc);
      fileName = `resume-${body.templateId}.pdf`;
      mimeType = "application/pdf";
    } else {
      // Generate DOCX
      const docxDoc = generateDOCXDocument(resumeContent, templateConfig);
      fileBuffer = await Packer.toBuffer(docxDoc);
      fileName = `resume-${body.templateId}.docx`;
      mimeType =
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    }

    // Convert buffer to base64 for response
    const base64File = fileBuffer.toString("base64");
    const fileSize = fileBuffer.length;

    // Create a temporary download URL (in production, you'd upload to storage)
    // For now, we'll return the file data directly
    const dataUrl = `data:${mimeType};base64,${base64File}`;

    return NextResponse.json({
      fileName,
      fileType: body.fileFormat,
      fileSize,
      downloadUrl: dataUrl,
      mimeType,
    });
  } catch (error) {
    console.error("Resume generation error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "An unexpected error occurred during file generation",
      },
      { status: 500 }
    );
  }
}
