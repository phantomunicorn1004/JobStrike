import { NextRequest, NextResponse } from "next/server";
import { parseResume } from "@/lib/resume/parseResume";
import { parseDOCXStructure } from "@/lib/resume/structure/docxParser";
import { inferStructureFromText, structureToContent } from "@/lib/resume/structure/infer";
import type { ResumeStructure } from "@/lib/resume/structure/types";
import type { ResumeContent } from "@/lib/resumeTemplates/types";

/**
 * Parse resume file and return structured content + structure (no tailoring).
 * Used by workflow Resume Selection node.
 */
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const parseResult = await parseResume(file, {
      maxFileSize: 5 * 1024 * 1024,
    });

    let structure: ResumeStructure;
    let content: ResumeContent;

    if (parseResult.fileType === "docx") {
      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const docxStructure = await parseDOCXStructure(buffer);
      structure = docxStructure.structure;
      const contentFromStructure = structureToContent(structure);
      content = {
        profileTitle: contentFromStructure.profileTitle,
        professionalSummary: contentFromStructure.professionalSummary ?? "",
        experience: contentFromStructure.experience,
        contactInfo: contentFromStructure.contactInfo,
        skills: contentFromStructure.skills,
        education: contentFromStructure.education,
        certifications: contentFromStructure.certifications,
      };
    } else {
      structure = inferStructureFromText(parseResult.text);
      const contentFromStructure = structureToContent(structure);
      content = {
        profileTitle: contentFromStructure.profileTitle,
        professionalSummary: contentFromStructure.professionalSummary ?? "",
        experience: contentFromStructure.experience,
        contactInfo: contentFromStructure.contactInfo,
        skills: contentFromStructure.skills,
        education: contentFromStructure.education,
        certifications: contentFromStructure.certifications,
      };
      structure.originalFormat = { fileType: "pdf" };
    }

    return NextResponse.json({ content, structure });
  } catch (error) {
    console.error("Resume parse-structure API error:", error);
    const errorMessage =
      error instanceof Error ? error.message : "An unexpected error occurred";
    return NextResponse.json(
      { error: errorMessage },
      { status: errorMessage.includes("experience") || errorMessage.includes("parse") ? 400 : 500 }
    );
  }
}
