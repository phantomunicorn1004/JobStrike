import { NextRequest } from "next/server";
import { corsJson, corsOptions } from "@/lib/api/extensionCors";
import { requireRequestUser } from "@/lib/auth/resolve-request-user";
import { normalizeCompanyName } from "@/lib/job-scraper";
import {
  addBlockedCompany,
  deleteBlockedCompanies,
  listBlockedAts,
  listBlockedCompanies,
  listBlockedJobs,
  listDistinctResumeDbCompanies,
  listJobScraperCandidates,
  listRegisteredJobsForCandidate,
} from "@/lib/job-scraper-repository";

export function OPTIONS() {
  return corsOptions();
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireRequestUser(request);
    const candidateFilter =
      new URL(request.url).searchParams.get("candidateFilter")?.trim() || "";
    const [blockedCompanies, blockedAts, blockedJobs, candidates, resumeDbCompanies, registeredJobs] =
      await Promise.all([
        listBlockedCompanies(user.id),
        listBlockedAts(user.id),
        listBlockedJobs(user.id),
        listJobScraperCandidates(user.id),
        listDistinctResumeDbCompanies(user.id, candidateFilter),
        listRegisteredJobsForCandidate(user.id, candidateFilter),
      ]);
    return corsJson({
      blockedCompanies,
      blockedAts,
      blockedJobs,
      candidates,
      candidateFilter: candidateFilter || null,
      resumeDbCompanies,
      resumeDbCompanyCount: resumeDbCompanies.length,
      registeredJobs,
      registeredJobCount: registeredJobs.length,
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
    const url = new URL(request.url);
    const singleId = url.searchParams.get("id")?.trim();
    const idsParam = url.searchParams.get("ids")?.trim();

    let ids: string[] = [];
    if (singleId) {
      ids = [singleId];
    } else if (idsParam) {
      ids = idsParam.split(",").map((id) => id.trim()).filter(Boolean);
    } else {
      const body = (await request.json().catch(() => null)) as {
        ids?: unknown;
        companiesText?: unknown;
      } | null;
      if (Array.isArray(body?.ids)) {
        ids = body.ids.map((id) => String(id).trim()).filter(Boolean);
      } else if (typeof body?.companiesText === "string") {
        const names = body.companiesText
          .split(/\r?\n/)
          .map((line) => normalizeCompanyName(line))
          .filter(Boolean);
        if (names.length > 0) {
          const all = await listBlockedCompanies(user.id);
          const nameSet = new Set(names);
          ids = all
            .filter((company) =>
              nameSet.has(normalizeCompanyName(company.companyName)),
            )
            .map((company) => company.id);
        }
      }
    }

    if (ids.length === 0) {
      return corsJson({ error: "Missing id(s)." }, { status: 400 });
    }

    const deleted = await deleteBlockedCompanies(user.id, ids);
    const blockedCompanies = await listBlockedCompanies(user.id);
    return corsJson({ ok: true, deleted, blockedCompanies });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to delete blocked company.";
    const status = message === "Unauthorized" ? 401 : 500;
    return corsJson({ error: message }, { status });
  }
}
