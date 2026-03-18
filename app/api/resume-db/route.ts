import { NextRequest, NextResponse } from "next/server";
import { parseResume } from "@/lib/resume/parseResume";
import { parseDOCXStructure } from "@/lib/resume/structure/docxParser";
import { inferStructureFromText, structureToContent } from "@/lib/resume/structure/infer";
import type { ResumeStructure } from "@/lib/resume/structure/types";
import type { ResumeContent } from "@/lib/resumeTemplates/types";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const idParam = searchParams.get("id");

    const supabase = await getSupabaseServerClient();

    if (idParam) {
      const id = Number(idParam);
      if (Number.isNaN(id)) {
        return NextResponse.json({ error: "Invalid id" }, { status: 400 });
      }

      const { data, error } = await supabase
        .from("resumes")
        .select("id, file_name, file_type, content, structure, created_at")
        .eq("id", id)
        .single();

      if (error) {
        console.error("Error fetching resume detail from Supabase:", error);
        return NextResponse.json(
          { error: "Failed to load resume detail from database." },
          { status: 500 },
        );
      }

      if (!data) {
        return NextResponse.json({ error: "Resume not found" }, { status: 404 });
      }

      return NextResponse.json({ resume: data });
    }

    const { data, error } = await supabase
      .from("resumes")
      .select("id, content")
      .order("id", { ascending: false });

    if (error) {
      console.error("Error fetching resumes from Supabase:", error);
      return NextResponse.json(
        { error: "Failed to load resumes from database." },
        { status: 500 },
      );
    }

    const rows =
      data?.map((row: any) => ({
        id: row.id,
        roleTitle: row.content?.profileTitle ?? "",
      })) ?? [];

    return NextResponse.json({ resumes: rows });
  } catch (error) {
    console.error("Resume DB GET API error:", error);
    return NextResponse.json(
      { error: "Unexpected error while loading resumes." },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get("content-type") || "";

    // JSON body: already parsed & edited resume content/structure
    if (contentType.includes("application/json")) {
      const body = await request.json();
      const { fileName, fileType, content, structure } = body as {
        fileName?: string;
        fileType?: string;
        content?: ResumeContent;
        structure?: ResumeStructure;
      };

      if (!fileName || !fileType || !content || !structure) {
        return NextResponse.json(
          { error: "Missing required fields: fileName, fileType, content, structure" },
          { status: 400 },
        );
      }

      const supabase = await getSupabaseServerClient();

      const { data, error } = await supabase
        .from("resumes")
        .insert({
          file_name: fileName,
          file_type: fileType,
          content,
          structure,
        })
        .select("id")
        .single();

      if (error) {
        console.error("Error inserting resume into Supabase (JSON):", error);
        return NextResponse.json(
          { error: "Failed to store resume in database." },
          { status: 500 },
        );
      }

      return NextResponse.json(
        {
          id: data.id,
          fileName,
          fileType,
        },
        { status: 201 },
      );
    }

    // Fallback: multipart upload (not used by current UI but kept for compatibility)
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

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

    const supabase = await getSupabaseServerClient();

    const { data, error } = await supabase
      .from("resumes")
      .insert({
        file_name: file.name,
        file_type: parseResult.fileType,
        content,
        structure,
      })
      .select("id")
      .single();

    if (error) {
      console.error("Error inserting resume into Supabase:", error);
      return NextResponse.json(
        { error: "Failed to store resume in database." },
        { status: 500 },
      );
    }

    return NextResponse.json(
      {
        id: data.id,
        fileName: file.name,
        fileType: parseResult.fileType,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Resume DB API error:", error);
    const message =
      error instanceof Error
        ? error.message
        : "An unexpected error occurred while processing the resume.";
    const statusCode = message.toLowerCase().includes("file") ? 400 : 500;
    return NextResponse.json({ error: message }, { status: statusCode });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, content, structure } = body as {
      id?: number;
      content?: ResumeContent;
      structure?: ResumeStructure;
    };

    if (id == null || typeof id !== "number" || !content || !structure) {
      return NextResponse.json(
        { error: "Missing required fields: id, content, structure" },
        { status: 400 },
      );
    }

    const supabase = await getSupabaseServerClient();

    const { error } = await supabase
      .from("resumes")
      .update({ content, structure })
      .eq("id", id);

    if (error) {
      console.error("Error updating resume in Supabase:", error);
      return NextResponse.json(
        { error: "Failed to update resume in database." },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true, id });
  } catch (error) {
    console.error("Resume DB PATCH API error:", error);
    return NextResponse.json(
      { error: "Unexpected error while updating resume." },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const idParam = searchParams.get("id");
    if (!idParam) {
      return NextResponse.json(
        { error: "Missing required query parameter: id" },
        { status: 400 },
      );
    }
    const id = Number(idParam);
    if (Number.isNaN(id)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const supabase = await getSupabaseServerClient();
    const { error } = await supabase.from("resumes").delete().eq("id", id);

    if (error) {
      console.error("Error deleting resume from Supabase:", error);
      return NextResponse.json(
        { error: "Failed to delete resume from database." },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true, id });
  } catch (error) {
    console.error("Resume DB DELETE API error:", error);
    return NextResponse.json(
      { error: "Unexpected error while deleting resume." },
      { status: 500 },
    );
  }
}

