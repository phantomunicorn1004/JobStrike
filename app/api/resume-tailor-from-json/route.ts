import { NextRequest, NextResponse } from "next/server";
import { tailorResumeFromContent } from "@/lib/resume/pipeline";
import type { ResumeContent } from "@/lib/resumeTemplates/types";
import type { ResumeStructure } from "@/lib/resume/structure/types";

/**
 * Tailor a resume from already-parsed content + structure (e.g. from ResumeDB).
 * Use when the workflow uses a resume selected from ResumeDB instead of an uploaded file.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      content,
      structure,
      jobTitle,
      jobDescription,
      openaiApiKey,
      model,
    } = body as {
      content: ResumeContent;
      structure: ResumeStructure;
      jobTitle: string;
      jobDescription: string;
      openaiApiKey?: string;
      model?: string;
    };

    if (!content || !structure) {
      return NextResponse.json(
        { error: "Missing required fields: content, structure" },
        { status: 400 }
      );
    }
    if (!jobTitle?.trim() || !jobDescription?.trim()) {
      return NextResponse.json(
        { error: "Missing required fields: jobTitle, jobDescription" },
        { status: 400 }
      );
    }

    const result = await tailorResumeFromContent({
      content,
      structure,
      jobTitle,
      jobDescription,
      ...(openaiApiKey?.trim() && { openaiApiKey: openaiApiKey.trim() }),
      ...(model?.trim() && { model: model.trim() }),
    });

    return NextResponse.json({
      tailoredText: result.tailoredText,
      tailoredContent: result.tailoredContent,
      structure: result.structure,
      formatMetadata: undefined,
    });
  } catch (error) {
    console.error("Resume tailor-from-JSON error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "An unexpected error occurred during resume tailoring",
      },
      { status: 500 }
    );
  }
}
