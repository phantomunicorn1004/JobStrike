import { NextRequest } from "next/server";
import { corsJson, corsOptions } from "@/lib/api/extensionCors";
import { requireRequestUser } from "@/lib/auth/resolve-request-user";
import {
  addBlockedCompany,
  deleteBlockedCompany,
  listBlockedCompanies,
  listDistinctResumeDbCompanies,
  listJobScraperCandidates,
} from "@/lib/job-scraper-repository";

export function OPTIONS() {
  return corsOptions();
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireRequestUser(request);
    const candidateFilter =
      new URL(request.url).searchParams.get("candidateFilter")?.trim() || "";
    const [blockedCompanies, candidates, resumeDbCompanies] = await Promise.all([
      listBlockedCompanies(user.id),
      listJobScraperCandidates(user.id),
      listDistinctResumeDbCompanies(user.id, candidateFilter),
    ]);
    return corsJson({
      blockedCompanies,
      candidates,
      candidateFilter: candidateFilter || null,
      resumeDbCompanies,
      resumeDbCompanyCount: resumeDbCompanies.length,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load blocked companies.";
    const status = message === "Unauthorized" ? 401 : 500;
    return corsJson({ error: message }, { status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireRequestUser(request);
    const body = (await request.json()) as Record<string, unknown>;
    const note = String(body.note ?? "").trim() || null;

    const rawNames =
      typeof body.companiesText === "string"
        ? body.companiesText
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean)
        : [];
    const single =
      typeof body.companyName === "string" ? body.companyName.trim() : "";
    const names = rawNames.length > 0 ? rawNames : single ? [single] : [];

    if (names.length === 0) {
      return corsJson({ error: "Company name is required." }, { status: 400 });
    }

    const added = [];
    for (const name of names) {
      try {
        added.push(await addBlockedCompany(user.id, name, note));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Add failed.";
        if (!/duplicate/i.test(message)) {
          throw error;
        }
      }
    }

    const blockedCompanies = await listBlockedCompanies(user.id);
    return corsJson({ ok: true, added, blockedCompanies });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to save blocked company.";
    const status = message === "Unauthorized" ? 401 : 500;
    return corsJson({ error: message }, { status });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = await requireRequestUser(request);
    const id = new URL(request.url).searchParams.get("id")?.trim();
    if (!id) {
      return corsJson({ error: "Missing id." }, { status: 400 });
    }
    await deleteBlockedCompany(user.id, id);
    return corsJson({ ok: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to delete blocked company.";
    const status = message === "Unauthorized" ? 401 : 500;
    return corsJson({ error: message }, { status });
  }
}
