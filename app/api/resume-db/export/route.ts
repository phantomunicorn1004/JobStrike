import { NextRequest, NextResponse } from "next/server";
import { getResumeDbEntry } from "@/lib/google-sheets/resumeDbSheet";
import type { ResumeDbJobExport } from "@/lib/google-sheets/types";
import { corsJson, corsOptions } from "@/lib/api/extensionCors";

export function OPTIONS() {
  return corsOptions();
}

function entryToExport(entry: Awaited<ReturnType<typeof getResumeDbEntry>>): ResumeDbJobExport | null {
  if (!entry) return null;
  return {
    entryId: entry.entryId,
    rowIndex: entry.rowIndex,
    candidate: entry.candidate,
    email: entry.email,
    jobLink: entry.jobLink,
    jobTitle: entry.jobTitle,
    company: entry.company,
    resumeUrl: entry.resumeUrl,
    coverLetterUrl: entry.coverLetterUrl,
    apply: entry.apply,
    date: entry.date,
    exportedAt: new Date().toISOString(),
  };
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const idParam = searchParams.get("id");
    if (!idParam) {
      return corsJson(
        { error: "Missing query parameter: id (sheet row index)" },
        { status: 400 },
      );
    }

    const rowIndex = Number(idParam);
    if (Number.isNaN(rowIndex) || rowIndex < 2) {
      return corsJson({ error: "Invalid row id" }, { status: 400 });
    }

    const entry = await getResumeDbEntry(rowIndex);
    const payload = entryToExport(entry);
    if (!payload) {
      return corsJson({ error: "Row not found" }, { status: 404 });
    }

    const download = searchParams.get("download") === "1";
    if (download) {
      const fileName = `resume-db-${payload.entryId || payload.rowIndex}.json`;
      return new NextResponse(JSON.stringify(payload, null, 2), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Content-Disposition": `attachment; filename="${fileName}"`,
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    return corsJson({ job: payload });
  } catch (error) {
    console.error("Resume DB export error:", error);
    const message = error instanceof Error ? error.message : "Export failed.";
    return corsJson({ error: message }, { status: 500 });
  }
}
