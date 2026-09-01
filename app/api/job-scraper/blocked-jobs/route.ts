import { NextRequest } from "next/server";
import { corsJson, corsOptions } from "@/lib/api/extensionCors";
import { requireRequestUser } from "@/lib/auth/resolve-request-user";
import {
  addBlockedJob,
  deleteBlockedJob,
  listBlockedJobs,
} from "@/lib/job-scraper-repository";

export function OPTIONS() {
  return corsOptions();
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireRequestUser(request);
    const blockedJobs = await listBlockedJobs(user.id);
    return corsJson({ blockedJobs });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load blocked jobs.";
    const status = message === "Unauthorized" ? 401 : 500;
    return corsJson({ error: message }, { status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireRequestUser(request);
    const body = (await request.json()) as Record<string, unknown>;
    const jobLink = String(body.jobLink ?? body.job_link ?? "").trim();
    const jobTitle = String(body.jobTitle ?? body.job_title ?? "").trim() || null;
    const companyName =
      String(body.companyName ?? body.company_name ?? "").trim() || null;
    const note = String(body.note ?? "").trim() || null;

    if (!jobLink) {
      return corsJson({ error: "Job link is required." }, { status: 400 });
    }

    try {
      const added = await addBlockedJob(user.id, { jobLink, jobTitle, companyName, note });
      const blockedJobs = await listBlockedJobs(user.id);
      return corsJson({ ok: true, added, blockedJobs });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Add failed.";
      if (/duplicate/i.test(message)) {
        const blockedJobs = await listBlockedJobs(user.id);
        return corsJson({ ok: true, alreadyBlocked: true, blockedJobs });
      }
      throw error;
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to save blocked job.";
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
    await deleteBlockedJob(user.id, id);
    return corsJson({ ok: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to delete blocked job.";
    const status = message === "Unauthorized" ? 401 : 500;
    return corsJson({ error: message }, { status });
  }
}
