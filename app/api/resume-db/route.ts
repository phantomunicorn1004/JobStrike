import { NextRequest } from "next/server";
import { parseResume } from "@/lib/resume/parseResume";
import { parseDOCXStructure } from "@/lib/resume/structure/docxParser";
import { inferStructureFromText, structureToContent } from "@/lib/resume/structure/infer";
import type { ResumeStructure } from "@/lib/resume/structure/types";
import type { ResumeContent } from "@/lib/resumeTemplates/types";
import { downloadFromGoogleDriveUrl } from "@/lib/google-sheets/drive";
import {
  appendResumeDbEntry,
  deleteResumeDbEntry,
  getResumeDbEntry,
  listResumeDbEntries,
  updateResumeDbEntry,
} from "@/lib/google-sheets/resumeDbSheet";
import type { ResumeDbEntryInput } from "@/lib/google-sheets/types";
import { corsJson, corsOptions } from "@/lib/api/extensionCors";

export function OPTIONS() {
  return corsOptions();
}

function sheetErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Unexpected Google Sheets error.";
}

function sheetErrorStatus(message: string): number {
  const lower = message.toLowerCase();
  if (
    lower.includes("missing") ||
    lower.includes("not set") ||
    lower.includes("invalid")
  ) {
    return 400;
  }
  if (lower.includes("not found")) return 404;
  return 500;
}

async function parseDriveResume(resumeUrl: string) {
  const { buffer, fileName, mimeType } =
    await downloadFromGoogleDriveUrl(resumeUrl);

  const extension = fileName.split(".").pop()?.toLowerCase();
  const fileType =
    extension === "docx" || mimeType.includes("wordprocessingml")
      ? "docx"
      : "pdf";

  const blob = new Blob([new Uint8Array(buffer)], {
    type:
      fileType === "docx"
        ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        : "application/pdf",
  });
  const file = new File([blob], fileName, { type: blob.type });

  const parseResult = await parseResume(file, { maxFileSize: 10 * 1024 * 1024 });

  let structure: ResumeStructure;
  let content: ResumeContent;

  if (parseResult.fileType === "docx") {
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

  return { content, structure, fileName, fileType };
}

function parseEntryBody(body: Record<string, unknown>): ResumeDbEntryInput {
  return {
    entryId: String(body.entryId ?? body.entry_id ?? "").trim(),
    candidate: String(body.candidate ?? "").trim(),
    email: String(body.email ?? "").trim(),
    jobLink: String(body.jobLink ?? body.job_link ?? "").trim(),
    apply: String(body.apply ?? body.status ?? "").trim(),
    jobTitle: String(body.jobTitle ?? body.job_title ?? "").trim(),
    company: String(body.company ?? body.company_name ?? "").trim(),
    resumeUrl: String(body.resumeUrl ?? body.resume_url ?? "").trim(),
    coverLetterUrl: String(
      body.coverLetterUrl ?? body.cover_letter_url ?? body.cover_letter_link ?? "",
    ).trim(),
    date: String(body.date ?? "").trim(),
  };
}

function mapEntryForList(e: Awaited<ReturnType<typeof listResumeDbEntries>>[number]) {
  return {
    rowIndex: e.rowIndex,
    entryId: e.entryId,
    candidate: e.candidate,
    email: e.email,
    jobLink: e.jobLink,
    apply: e.apply,
    jobTitle: e.jobTitle,
    company: e.company,
    resumeUrl: e.resumeUrl,
    coverLetterUrl: e.coverLetterUrl,
    date: e.date,
    id: e.rowIndex,
    roleTitle: e.jobTitle || e.candidate || `Row ${e.rowIndex}`,
  };
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const idParam = searchParams.get("id");
    const shouldParse = searchParams.get("parse") === "true";

    if (idParam) {
      const rowIndex = Number(idParam);
      if (Number.isNaN(rowIndex) || rowIndex < 2) {
        return corsJson({ error: "Invalid row id" }, { status: 400 });
      }

      const entry = await getResumeDbEntry(rowIndex);
      if (!entry) {
        return corsJson({ error: "Row not found in sheet" }, { status: 404 });
      }

      if (!shouldParse) {
        return corsJson({ resume: entry });
      }

      if (!entry.resumeUrl) {
        return corsJson(
          { error: "This row has no resume_url set." },
          { status: 400 },
        );
      }

      const parsed = await parseDriveResume(entry.resumeUrl);
      return corsJson({
        resume: {
          ...entry,
          content: parsed.content,
          structure: parsed.structure,
          fileName: parsed.fileName,
          fileType: parsed.fileType,
        },
      });
    }

    const entries = await listResumeDbEntries();
    return corsJson({
      resumes: entries.map(mapEntryForList),
    });
  } catch (error) {
    console.error("Resume DB GET error:", error);
    const message = sheetErrorMessage(error);
    return corsJson({ error: message }, { status: sheetErrorStatus(message) });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const entry = parseEntryBody(body);

    if (!entry.jobTitle && !entry.candidate) {
      return corsJson(
        { error: "At least job title or candidate is required." },
        { status: 400 },
      );
    }

    if (!entry.resumeUrl) {
      return corsJson(
        { error: "resume_url (Google Drive link) is required." },
        { status: 400 },
      );
    }

    const { rowIndex } = await appendResumeDbEntry(entry);
    return corsJson({ rowIndex, ...entry }, { status: 201 });
  } catch (error) {
    console.error("Resume DB POST error:", error);
    const message = sheetErrorMessage(error);
    return corsJson({ error: message }, { status: sheetErrorStatus(message) });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const rowIndex = Number(body.rowIndex ?? body.id);
    if (Number.isNaN(rowIndex) || rowIndex < 2) {
      return corsJson(
        { error: "Missing or invalid rowIndex" },
        { status: 400 },
      );
    }

    const existing = await getResumeDbEntry(rowIndex);
    const entry = parseEntryBody(body);
    if (!entry.entryId && existing?.entryId) {
      entry.entryId = existing.entryId;
    }

    await updateResumeDbEntry(rowIndex, entry);
    return corsJson({ ok: true, rowIndex, ...entry });
  } catch (error) {
    console.error("Resume DB PATCH error:", error);
    const message = sheetErrorMessage(error);
    return corsJson({ error: message }, { status: sheetErrorStatus(message) });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const idParam = searchParams.get("id");
    if (!idParam) {
      return corsJson(
        { error: "Missing required query parameter: id" },
        { status: 400 },
      );
    }

    const rowIndex = Number(idParam);
    if (Number.isNaN(rowIndex) || rowIndex < 2) {
      return corsJson({ error: "Invalid id" }, { status: 400 });
    }

    await deleteResumeDbEntry(rowIndex);
    return corsJson({ ok: true, rowIndex });
  } catch (error) {
    console.error("Resume DB DELETE error:", error);
    const message = sheetErrorMessage(error);
    return corsJson({ error: message }, { status: sheetErrorStatus(message) });
  }
}
