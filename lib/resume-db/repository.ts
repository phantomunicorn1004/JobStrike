import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import type {
  ProfileListItem,
  ResumeDbApplication,
  ResumeDbApplicationInput,
} from "@/lib/resume-db/types";
import { DEFAULT_TIMEZONE, endOfDayUtcIso, normalizeTimeZone, startOfDayUtcIso } from "@/lib/timezone";
import { fetchAllByRange } from "@/lib/supabase/fetch-all";

type DbRow = {
  id: number;
  entry_id: string;
  profile_id: number | null;
  user_id: string;
  candidate_name: string;
  job_link: string;
  job_title: string;
  company: string;
  note: string | null;
  apply: string;
  resume_url: string;
  cover_letter_url: string;
  applied_at: string;
  created_at: string;
  pipeline_job_id: number | null;
  resume_storage_path: string | null;
  cover_letter_storage_path: string | null;
  resume_drive_file_id: string | null;
  cover_drive_file_id: string | null;
};

type ProfileRow = {
  id: number;
  full_name: string;
  dob: string;
  work_emails: string[];
  phone_numbers: string[];
  ssn: string;
  address: string;
  city: string;
  state: string;
  postal_code: string;
  university: string;
  linkedin: string;
  user_id: string;
  created_at: string;
  updated_at: string;
};

export type ProfileRecord = Omit<ProfileRow, "user_id">;

function mapRow(row: DbRow): ResumeDbApplication {
  return {
    id: row.id,
    entryId: row.entry_id,
    profileId: row.profile_id,
    candidateName: row.candidate_name,
    jobLink: row.job_link,
    jobTitle: row.job_title,
    company: row.company,
    note: row.note ?? "",
    apply: row.apply,
    resumeUrl: row.resume_url,
    coverLetterUrl: row.cover_letter_url ?? "",
    appliedAt: row.applied_at,
    createdAt: row.created_at,
    pipelineJobId: row.pipeline_job_id ?? null,
    resumeStoragePath: row.resume_storage_path ?? null,
    coverLetterStoragePath: row.cover_letter_storage_path ?? null,
    resumeDriveFileId: row.resume_drive_file_id ?? null,
    coverDriveFileId: row.cover_drive_file_id ?? null,
  };
}

export async function listProfiles(userId: string): Promise<ProfileListItem[]> {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name")
    .eq("user_id", userId)
    .order("full_name", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as ProfileListItem[];
}

export async function listProfileRecords(userId: string): Promise<ProfileRecord[]> {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("user_id", userId)
    .order("id", { ascending: true });

  if (error) throw new Error(error.message);
  return ((data ?? []) as ProfileRow[]).map(({ user_id: _uid, ...profile }) => profile);
}

export async function createProfile(
  userId: string,
  input: Omit<ProfileRecord, "id" | "created_at" | "updated_at">,
): Promise<ProfileRecord> {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("profiles")
    .insert({ ...input, user_id: userId } as never)
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  const row = data as ProfileRow;
  const { user_id: _uid, ...profile } = row;
  return profile;
}

export async function updateProfile(
  userId: string,
  profileId: number,
  input: Partial<Omit<ProfileRecord, "id" | "created_at" | "updated_at">>,
): Promise<void> {
  const supabase = getSupabaseAdminClient();
  const { error } = await supabase
    .from("profiles")
    .update({ ...input, updated_at: new Date().toISOString() } as never)
    .eq("id", profileId)
    .eq("user_id", userId);

  if (error) throw new Error(error.message);
}

export async function deleteProfile(userId: string, profileId: number): Promise<void> {
  const supabase = getSupabaseAdminClient();
  const { error } = await supabase
    .from("profiles")
    .delete()
    .eq("id", profileId)
    .eq("user_id", userId);

  if (error) throw new Error(error.message);
}

export async function getProfileById(
  userId: string,
  profileId: number,
): Promise<ProfileRecord | null> {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", profileId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;
  const row = data as ProfileRow;
  const { user_id: _uid, ...profile } = row;
  return profile;
}

export async function listApplications(userId: string): Promise<ResumeDbApplication[]> {
  const supabase = getSupabaseAdminClient();
  const data = await fetchAllByRange<DbRow>((from, to) =>
    supabase
      .from("resume_db_applications")
      .select("*")
      .eq("user_id", userId)
      .order("id", { ascending: false })
      .range(from, to),
  );
  return data.map(mapRow);
}

export type ResumeDbApplicationsListQuery = {
  search?: string;
  dateFrom?: string; // YYYY-MM-DD
  dateTo?: string; // YYYY-MM-DD
  timeZone?: string;
  candidateFilter?: string; // "profile-{id}" | "name-{encodedName}"
  statusIncludeIds?: number[]; // only these application ids
  statusExcludeIds?: number[]; // exclude these application ids
  sortKey?: "company" | "jobTitle" | "pipeline" | null;
  sortDir?: "asc" | "desc";
  page?: number; // 1-based
  pageSize?: number;
};

function parseCandidateFilter(
  candidateFilter?: string,
): { profileId?: number; nameEquals?: string } | null {
  if (!candidateFilter) return null;
  if (candidateFilter.startsWith("profile-")) {
    const id = Number(candidateFilter.slice(8));
    if (Number.isNaN(id)) return null;
    return { profileId: id };
  }
  if (candidateFilter.startsWith("name-")) {
    const name = decodeURIComponent(candidateFilter.slice(5));
    if (!name.trim()) return null;
    return { nameEquals: name.trim() };
  }
  return null;
}

function applyCommonFilters(
  query: ReturnType<typeof getSupabaseAdminClient>["from"],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supaQuery: any,
  userId: string,
  q: ResumeDbApplicationsListQuery,
) {
  let builder = supaQuery.eq("user_id", userId);

  const search = q.search?.trim();
  if (search) {
    const safe = search.replace(/[%_*]/g, "").trim();
    const pattern = `%${safe}%`;
    // OR across the main user-visible text fields.
    builder = builder.or(
      `company.ilike.${pattern},job_title.ilike.${pattern},candidate_name.ilike.${pattern},job_link.ilike.${pattern},note.ilike.${pattern},apply.ilike.${pattern},entry_id.ilike.${pattern}`,
    );
  }

  const from = q.dateFrom?.trim();
  const timeZone = normalizeTimeZone(q.timeZone ?? DEFAULT_TIMEZONE);
  if (from) {
    builder = builder.gte("applied_at", startOfDayUtcIso(from, timeZone));
  }
  const to = q.dateTo?.trim();
  if (to) {
    builder = builder.lte("applied_at", endOfDayUtcIso(to, timeZone));
  }

  const candidate = parseCandidateFilter(q.candidateFilter);
  if (candidate?.profileId != null) {
    builder = builder.eq("profile_id", candidate.profileId);
  } else if (candidate?.nameEquals != null) {
    builder = builder.is("profile_id", null).eq(
      "candidate_name",
      candidate.nameEquals,
    );
  }

  if (q.statusIncludeIds) {
    if (q.statusIncludeIds.length === 0) builder = builder.eq("id", -1);
    else builder = builder.in("id", q.statusIncludeIds);
  }

  if (q.statusExcludeIds && q.statusExcludeIds.length > 0) {
    builder = builder.not("id", "in", q.statusExcludeIds);
  }

  return builder;
}

export async function countApplicationsWithFilters(
  userId: string,
  query: ResumeDbApplicationsListQuery,
): Promise<number> {
  const supabase = getSupabaseAdminClient();

  let builder = supabase
    .from("resume_db_applications")
    .select("id", { count: "exact", head: true });

  builder = applyCommonFilters(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    builder as any,
    userId,
    query,
  );

  const { count, error } = await builder;
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function listApplicationsWithFilters(
  userId: string,
  query: ResumeDbApplicationsListQuery,
): Promise<ResumeDbApplication[]> {
  const supabase = getSupabaseAdminClient();
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.max(1, query.pageSize ?? 25);
  const start = (page - 1) * pageSize;
  const end = start + pageSize - 1;

  let builder = supabase
    .from("resume_db_applications")
    .select("*");

  builder = applyCommonFilters(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    builder as any,
    userId,
    query,
  );

  const sortKey = query.sortKey ?? null;
  const sortDir = query.sortDir ?? "asc";

  if (sortKey === "company") {
    builder = builder.order("company", { ascending: sortDir === "asc" });
    builder = builder.order("id", { ascending: false });
  } else if (sortKey === "jobTitle") {
    builder = builder.order("job_title", { ascending: sortDir === "asc" });
    builder = builder.order("id", { ascending: false });
  } else {
    // Default stable sort: most recently created first.
    builder = builder.order("id", { ascending: false });
  }

  const { data, error } = await builder.range(start, end);
  if (error) throw new Error(error.message);
  return ((data ?? []) as DbRow[]).map(mapRow);
}

export async function getApplicationById(
  id: number,
  userId: string,
): Promise<ResumeDbApplication | null> {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("resume_db_applications")
    .select("*")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;
  return mapRow(data as DbRow);
}

export async function createApplication(
  userId: string,
  input: ResumeDbApplicationInput,
): Promise<ResumeDbApplication> {
  const supabase = getSupabaseAdminClient();
  const row = {
    user_id: userId,
    entry_id: input.entryId,
    profile_id: input.profileId ?? null,
    candidate_name: input.candidateName,
    job_link: input.jobLink,
    job_title: input.jobTitle,
    company: input.company,
    note: input.note ?? "",
    apply: input.apply ?? "Registered",
    resume_url: input.resumeUrl,
    cover_letter_url: input.coverLetterUrl ?? "",
    resume_storage_path: input.resumeStoragePath ?? null,
    cover_letter_storage_path: input.coverLetterStoragePath ?? null,
    resume_drive_file_id: input.resumeDriveFileId ?? null,
    cover_drive_file_id: input.coverDriveFileId ?? null,
  };

  const { data, error } = await supabase
    .from("resume_db_applications")
    .insert(row as never)
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return mapRow(data as DbRow);
}

export async function updateApplication(
  id: number,
  userId: string,
  input: Partial<ResumeDbApplicationInput>,
): Promise<void> {
  const supabase = getSupabaseAdminClient();
  const patch: Record<string, unknown> = {};
  if (input.profileId !== undefined) patch.profile_id = input.profileId;
  if (input.candidateName !== undefined) patch.candidate_name = input.candidateName;
  if (input.jobLink !== undefined) patch.job_link = input.jobLink;
  if (input.jobTitle !== undefined) patch.job_title = input.jobTitle;
  if (input.company !== undefined) patch.company = input.company;
  if (input.note !== undefined) patch.note = input.note;
  if (input.apply !== undefined) patch.apply = input.apply;
  if (input.resumeUrl !== undefined) patch.resume_url = input.resumeUrl;
  if (input.coverLetterUrl !== undefined) patch.cover_letter_url = input.coverLetterUrl;
  if (input.pipelineJobId !== undefined) patch.pipeline_job_id = input.pipelineJobId;
  if (input.resumeStoragePath !== undefined) {
    patch.resume_storage_path = input.resumeStoragePath;
  }
  if (input.coverLetterStoragePath !== undefined) {
    patch.cover_letter_storage_path = input.coverLetterStoragePath;
  }
  if (input.resumeDriveFileId !== undefined) {
    patch.resume_drive_file_id = input.resumeDriveFileId;
  }
  if (input.coverDriveFileId !== undefined) {
    patch.cover_drive_file_id = input.coverDriveFileId;
  }

  const { error } = await supabase
    .from("resume_db_applications")
    .update(patch as never)
    .eq("id", id)
    .eq("user_id", userId);

  if (error) throw new Error(error.message);
}

export async function deleteApplication(id: number, userId: string): Promise<void> {
  const supabase = getSupabaseAdminClient();
  const { error } = await supabase
    .from("resume_db_applications")
    .delete()
    .eq("id", id)
    .eq("user_id", userId);

  if (error) throw new Error(error.message);
}
