import { NextRequest, NextResponse } from "next/server";
import { getApplicationById } from "@/lib/resume-db/repository";
import type { ResumeDbJobExport } from "@/lib/resume-db/types";
import { corsJson, corsOptions } from "@/lib/api/extensionCors";
import {
  resolveRequestUser,
  unauthorizedJson,
} from "@/lib/auth/resolve-request-user";

export function OPTIONS() {
  return corsOptions();
}

export async function GET(request: NextRequest) {
  try {
    const user = await resolveRequestUser(request);
    if (!user) {
      return corsJson(unauthorizedJson(), { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const idParam = searchParams.get("id");
    if (!idParam) {
      return corsJson({ error: "Missing query parameter: id" }, { status: 400 });
    }

    const id = Number(idParam);
    if (Number.isNaN(id) || id < 1) {
      return corsJson({ error: "Invalid id" }, { status: 400 });
    }

    const entry = await getApplicationById(id, user.id);
    if (!entry) {
      return corsJson({ error: "Application not found" }, { status: 404 });
    }

    const payload: ResumeDbJobExport = {
      entryId: entry.entryId,
      id: entry.id,
      profileId: entry.profileId,
      candidateName: entry.candidateName,
      jobLink: entry.jobLink,
      jobTitle: entry.jobTitle,
      company: entry.company,
      note: entry.note ?? "",
      resumeUrl: entry.resumeUrl,
      coverLetterUrl: entry.coverLetterUrl,
      apply: entry.apply,
      appliedAt: entry.appliedAt,
      exportedAt: new Date().toISOString(),
    };

    if (searchParams.get("download") === "1") {
      const fileName = `resume-db-${payload.entryId || payload.id}.json`;
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
