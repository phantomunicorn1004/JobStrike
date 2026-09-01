import "server-only";

import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { fetchAllByRange } from "@/lib/supabase/fetch-all";
import { normalizeCompanyName } from "@/lib/job-scraper";
import { canonicalJobUrl } from "@/lib/job-url";

export type BlockedCompany = {
  id: string;
  companyName: string;
  note: string | null;
  createdAt: string;
};

type BlockedCompanyRow = {
  id: string;
  user_id: string;
  company_name: string;
  company_name_normalized: string;
  note: string | null;
  created_at: string;
};

function mapBlockedCompany(row: BlockedCompanyRow): BlockedCompany {
  return {
    id: row.id,
    companyName: row.company_name,
    note: row.note,
    createdAt: row.created_at,
  };
}

export async function listBlockedCompanies(userId: string): Promise<BlockedCompany[]> {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("resume_db_blocked_companies")
    .select("*")
    .eq("user_id", userId)
    .order("company_name", { ascending: true });

  if (error) throw new Error(error.message);
  return ((data ?? []) as BlockedCompanyRow[]).map(mapBlockedCompany);
}

export async function addBlockedCompany(
  userId: string,
  companyName: string,
  note?: string | null,
): Promise<BlockedCompany> {
  const normalized = normalizeCompanyName(companyName);
  if (!normalized) {
    throw new Error("Company name is required.");
  }

  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("resume_db_blocked_companies")
    .insert({
      user_id: userId,
      company_name: companyName.trim(),
      company_name_normalized: normalized,
      note: note?.trim() || null,
    } as never)
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return mapBlockedCompany(data as BlockedCompanyRow);
}

export async function deleteBlockedCompany(userId: string, id: string): Promise<void> {
  const supabase = getSupabaseAdminClient();
  const { error } = await supabase
    .from("resume_db_blocked_companies")
    .delete()
    .eq("user_id", userId)
    .eq("id", id);

  if (error) throw new Error(error.message);
}

export type CandidateOption = {
  key: string;
  label: string;
};

function parseCandidateFilter(
  candidateFilter?: string | null,
): { profileId?: number; nameEquals?: string } | null {
  const raw = candidateFilter?.trim();
  if (!raw) return null;
  if (raw.startsWith("profile-")) {
    const id = Number(raw.slice(8));
    if (Number.isNaN(id)) return null;
    return { profileId: id };
  }
  if (raw.startsWith("name-")) {
    const name = decodeURIComponent(raw.slice(5)).trim();
    if (!name) return null;
    return { nameEquals: name };
  }
  return null;
}

export async function listJobScraperCandidates(userId: string): Promise<CandidateOption[]> {
  const supabase = getSupabaseAdminClient();
  const [profilesRes, orphanRows] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name")
      .eq("user_id", userId)
      .order("full_name", { ascending: true }),
    fetchAllByRange<{ candidate_name?: string | null }>((from, to) =>
      supabase
        .from("resume_db_applications")
        .select("candidate_name")
        .eq("user_id", userId)
        .is("profile_id", null)
        .order("id", { ascending: true })
        .range(from, to),
    ),
  ]);

  if (profilesRes.error) throw new Error(profilesRes.error.message);

  const options: CandidateOption[] = (
    (profilesRes.data ?? []) as Array<{ id: number; full_name: string }>
  ).map((profile) => ({
    key: `profile-${profile.id}`,
    label: profile.full_name,
  }));

  const profileNames = new Set(
    options.map((option) => option.label.trim().toLowerCase()).filter(Boolean),
  );
  const orphanNames = new Map<string, string>();
  for (const row of orphanRows) {
    const name = row.candidate_name?.trim();
    if (!name) continue;
    const normalized = name.toLowerCase();
    if (profileNames.has(normalized)) continue;
    orphanNames.set(normalized, name);
  }

  for (const name of orphanNames.values()) {
    options.push({
      key: `name-${encodeURIComponent(name)}`,
      label: name,
    });
  }

  return options.sort((a, b) =>
    a.label.localeCompare(b.label, undefined, { sensitivity: "base" }),
  );
}

export async function listDistinctResumeDbCompanies(
  userId: string,
  candidateFilter?: string | null,
): Promise<string[]> {
  const parsed = parseCandidateFilter(candidateFilter);
  if (!parsed) return [];

  const supabase = getSupabaseAdminClient();
  const data = await fetchAllByRange<{ company?: string | null }>((from, to) => {
    let builder = supabase
      .from("resume_db_applications")
      .select("company")
      .eq("user_id", userId)
      .order("id", { ascending: true });

    if (parsed.profileId != null) {
      builder = builder.eq("profile_id", parsed.profileId);
    } else if (parsed.nameEquals != null) {
      builder = builder.is("profile_id", null).eq("candidate_name", parsed.nameEquals);
    }

    return builder.range(from, to);
  });

  const seen = new Set<string>();
  const result: string[] = [];
  for (const row of data) {
    const raw = row.company?.trim();
    const normalized = normalizeCompanyName(raw);
    if (!raw || !normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(raw);
  }
  return result.sort((a, b) => a.localeCompare(b));
}

export type RegisteredJobRow = {
  jobLink: string;
  jobTitle: string;
  company: string;
};

export async function listRegisteredJobsForCandidate(
  userId: string,
  candidateFilter?: string | null,
): Promise<RegisteredJobRow[]> {
  const parsed = parseCandidateFilter(candidateFilter);
  if (!parsed) return [];

  const supabase = getSupabaseAdminClient();
  const data = await fetchAllByRange<{
    job_link?: string | null;
    job_title?: string | null;
    company?: string | null;
  }>((from, to) => {
    let builder = supabase
      .from("resume_db_applications")
      .select("job_link, job_title, company")
      .eq("user_id", userId)
      .order("id", { ascending: true });

    if (parsed.profileId != null) {
      builder = builder.eq("profile_id", parsed.profileId);
    } else if (parsed.nameEquals != null) {
      builder = builder.is("profile_id", null).eq("candidate_name", parsed.nameEquals);
    }

    return builder.range(from, to);
  });

  return data.map((row) => ({
    jobLink: row.job_link?.trim() || "",
    jobTitle: row.job_title?.trim() || "",
    company: row.company?.trim() || "",
  }));
}

export type BlockedAts = {
  id: string;
  atsName: string;
  note: string | null;
  createdAt: string;
};

type BlockedAtsRow = {
  id: string;
  user_id: string;
  ats_name: string;
  ats_name_normalized: string;
  note: string | null;
  created_at: string;
};

function mapBlockedAts(row: BlockedAtsRow): BlockedAts {
  return {
    id: row.id,
    atsName: row.ats_name,
    note: row.note,
    createdAt: row.created_at,
  };
}

function normalizeAtsForStorage(value: string): string {
  return value.trim().toLowerCase();
}

export async function listBlockedAts(userId: string): Promise<BlockedAts[]> {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("resume_db_blocked_ats")
    .select("*")
    .eq("user_id", userId)
    .order("ats_name", { ascending: true });

  if (error) throw new Error(error.message);
  return ((data ?? []) as BlockedAtsRow[]).map(mapBlockedAts);
}

export async function addBlockedAts(
  userId: string,
  atsName: string,
  note?: string | null,
): Promise<BlockedAts> {
  const trimmed = atsName.trim();
  const normalized = normalizeAtsForStorage(trimmed);
  if (!normalized) {
    throw new Error("ATS name is required.");
  }

  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("resume_db_blocked_ats")
    .insert({
      user_id: userId,
      ats_name: trimmed,
      ats_name_normalized: normalized,
      note: note?.trim() || null,
    } as never)
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return mapBlockedAts(data as BlockedAtsRow);
}

export async function deleteBlockedAts(userId: string, id: string): Promise<void> {
  const supabase = getSupabaseAdminClient();
  const { error } = await supabase
    .from("resume_db_blocked_ats")
    .delete()
    .eq("user_id", userId)
    .eq("id", id);

  if (error) throw new Error(error.message);
}

export type BlockedJob = {
  id: string;
  jobLink: string;
  jobTitle: string | null;
  companyName: string | null;
  note: string | null;
  createdAt: string;
};

type BlockedJobRow = {
  id: string;
  user_id: string;
  job_link: string;
  job_link_canonical: string;
  job_title: string | null;
  company_name: string | null;
  note: string | null;
  created_at: string;
};

function mapBlockedJob(row: BlockedJobRow): BlockedJob {
  return {
    id: row.id,
    jobLink: row.job_link,
    jobTitle: row.job_title,
    companyName: row.company_name,
    note: row.note,
    createdAt: row.created_at,
  };
}

export async function listBlockedJobs(userId: string): Promise<BlockedJob[]> {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("resume_db_blocked_jobs")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return ((data ?? []) as BlockedJobRow[]).map(mapBlockedJob);
}

export async function addBlockedJob(
  userId: string,
  input: {
    jobLink: string;
    jobTitle?: string | null;
    companyName?: string | null;
    note?: string | null;
  },
): Promise<BlockedJob> {
  const jobLink = input.jobLink.trim();
  const canonical = canonicalJobUrl(jobLink);
  if (!canonical) {
    throw new Error("A valid job link is required.");
  }

  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("resume_db_blocked_jobs")
    .insert({
      user_id: userId,
      job_link: jobLink,
      job_link_canonical: canonical,
      job_title: input.jobTitle?.trim() || null,
      company_name: input.companyName?.trim() || null,
      note: input.note?.trim() || null,
    } as never)
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return mapBlockedJob(data as BlockedJobRow);
}

export async function deleteBlockedJob(userId: string, id: string): Promise<void> {
  const supabase = getSupabaseAdminClient();
  const { error } = await supabase
    .from("resume_db_blocked_jobs")
    .delete()
    .eq("user_id", userId)
    .eq("id", id);

  if (error) throw new Error(error.message);
}
