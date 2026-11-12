import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  GENERATION_STATUSES,
  toBidState,
  type BidState,
  type GenerationStatus,
  type ProfileListItem,
  type ResumeDbApplication,
  type ResumeDbApplicationInput,
  type ResumeDbSortDir,
  type ResumeDbSortKey,
} from "@/lib/resume-db/types";
import { DEFAULT_TIMEZONE, endOfDayUtcIso, normalizeTimeZone, startOfDayUtcIso } from "@/lib/timezone";
import { fetchAllByRange } from "@/lib/supabase/fetch-all";
import type { ProfileAutofill } from "@/lib/resume-db/profile-autofill";
import { atsPlatformFromLink, atsPlatformLinkPatterns, countAtsPlatforms } from "@/lib/ats-platform";
import { jobLinksMatch } from "@/lib/job-url";

type DbRow = {
  id: number;
  entry_id: string;
  profile_id: number | null;
  user_id: string;
  candidate_name: string;
  job_link: string;
  job_title: string;
  company: string;
  /** Absent until scripts/add-ats-platform-to-resume-db.sql has run; null on rows registered before it. */
  ats_platform?: string | null;
  note: string | null;
  apply: string;
  resume_url: string;
  cover_letter_url: string;
  applied_at: string;
  created_at: string;
  pipeline_job_id: number | null;
  pipeline_stage_id?: string | null;
  resume_storage_path: string | null;
  cover_letter_storage_path: string | null;
  resume_drive_file_id: string | null;
  cover_drive_file_id: string | null;
  /** Absent until scripts/add-autogen-to-resume-db.sql has run. */
  job_description?: string | null;
  generation_status?: string | null;
  autogen_claimed_at?: string | null;
  generation_error?: string | null;
  generation_meta?: Record<string, unknown> | null;
  built_resume_json?: string | null;
  /** Absent until scripts/add-autobid-to-resume-db.sql has run. */
  bid_state?: string | null;
  bid_error?: string | null;
};

function toGenerationStatus(value: unknown): GenerationStatus {
  const raw = String(value ?? "").trim().toLowerCase();
  return (GENERATION_STATUSES as readonly string[]).includes(raw) ? (raw as GenerationStatus) : "none";
}

/** Columns needed for Resume DB table list (avoid select *). */
const RESUME_DB_LIST_COLUMNS =
  "id, entry_id, profile_id, user_id, candidate_name, job_link, job_title, company, note, apply, resume_url, cover_letter_url, applied_at, created_at, pipeline_job_id, pipeline_stage_id";

/** Set once a query shows the ats_platform column is not there yet (its script has not run). */
let atsPlatformColumnMissing = false;

function isMissingAtsPlatformColumn(message: string): boolean {
  return /ats_platform/i.test(message);
}

/** Set once a query shows the bid_state column is not there yet (its script has not run). */
let bidStateColumnMissing = false;

function isMissingBidStateColumn(message: string): boolean {
  return /bid_state/i.test(message);
}

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
  /** Application-form answers; absent until scripts/add-profile-autofill.sql has run. */
  autofill?: ProfileAutofill | null;
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
    atsPlatform: row.ats_platform?.trim() || atsPlatformFromLink(row.job_link),
    note: row.note ?? "",
    apply: row.apply,
    resumeUrl: row.resume_url,
    coverLetterUrl: row.cover_letter_url ?? "",
    appliedAt: row.applied_at,
    createdAt: row.created_at,
    pipelineJobId: row.pipeline_job_id ?? null,
    pipelineStageId: row.pipeline_stage_id ?? null,
    resumeStoragePath: row.resume_storage_path ?? null,
    coverLetterStoragePath: row.cover_letter_storage_path ?? null,
    resumeDriveFileId: row.resume_drive_file_id ?? null,
    coverDriveFileId: row.cover_drive_file_id ?? null,
    jobDescription: row.job_description ?? "",
    generationStatus: toGenerationStatus(row.generation_status),
    autogenClaimedAt: row.autogen_claimed_at ?? null,
    generationError: row.generation_error ?? "",
    generationMeta: row.generation_meta ?? null,
    builtResumeJson: row.built_resume_json ?? null,
    bidState: toBidState(row.bid_state),
    bidError: row.bid_error ?? "",
  };
}

/** Same mapping as the rest of Resume DB, for modules that query rows themselves (AutoGen). */
export function mapApplicationRow(row: Record<string, unknown>): ResumeDbApplication {
  return mapRow(row as unknown as DbRow);
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

/** PostgREST's error when profiles.autofill has not been added yet. */
function isMissingAutofillColumn(message: string | undefined): boolean {
  const text = String(message ?? "");
  // "Could not find the 'autofill' column of 'profiles' in the schema cache" /
  // "column profiles.autofill does not exist" — not any error that mentions the word.
  return /autofill/i.test(text) && /column|schema cache/i.test(text);
}

export async function createProfile(
  userId: string,
  input: Omit<ProfileRecord, "id" | "created_at" | "updated_at">,
): Promise<ProfileRecord> {
  const supabase = getSupabaseAdminClient();
  let { data, error } = await supabase
    .from("profiles")
    .insert({ ...input, user_id: userId } as never)
    .select("*")
    .single();

  // The profile itself must still save on a database that predates the column.
  if (error && "autofill" in input && isMissingAutofillColumn(error.message)) {
    const { autofill: _autofill, ...core } = input;
    ({ data, error } = await supabase
      .from("profiles")
      .insert({ ...core, user_id: userId } as never)
      .select("*")
      .single());
  }

  if (error) throw new Error(error.message);
  const row = data as unknown as ProfileRow;
  const { user_id: _uid, ...profile } = row;
  return profile;
}

export async function updateProfile(
  userId: string,
  profileId: number,
  input: Partial<Omit<ProfileRecord, "id" | "created_at" | "updated_at">>,
): Promise<{ autofillSaved: boolean }> {
  const supabase = getSupabaseAdminClient();
  const save = (values: typeof input) =>
    supabase
      .from("profiles")
      .update({ ...values, updated_at: new Date().toISOString() } as never)
      .eq("id", profileId)
      .eq("user_id", userId);

  let { error } = await save(input);
  let autofillSaved = "autofill" in input;

  // Save the rest on a database that predates the column, and say so.
  if (error && "autofill" in input && isMissingAutofillColumn(error.message)) {
    const { autofill: _autofill, ...core } = input;
    ({ error } = await save(core));
    autofillSaved = false;
  }

  if (error) throw new Error(error.message);
  return { autofillSaved };
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

/**
 * An earlier application of this profile with the same job (links compared the
 * way the extension and scraper compare them), or null.
 */
export async function findApplicationByJobLink(
  userId: string,
  profileId: number,
  jobLink: string,
): Promise<{ id: number; jobLink: string } | null> {
  const supabase = getSupabaseAdminClient();
  const rows = await fetchAllByRange<{ id: number; job_link: string | null }>((from, to) =>
    supabase
      .from("resume_db_applications")
      .select("id, job_link")
      .eq("user_id", userId)
      .eq("profile_id", profileId)
      .order("id", { ascending: false })
      .range(from, to),
  );
  const hit = rows.find((row) => jobLinksMatch(row.job_link, jobLink));
  return hit ? { id: hit.id, jobLink: hit.job_link || "" } : null;
}

/** The user's registered bids per ATS platform, most used first. */
export async function listAtsPlatformCounts(
  userId: string,
): Promise<Array<{ name: string; count: number }>> {
  const supabase = getSupabaseAdminClient();
  const rows = await fetchAllByRange<{ job_link: string | null }>((from, to) =>
    supabase
      .from("resume_db_applications")
      .select("job_link")
      .eq("user_id", userId)
      .order("id", { ascending: false })
      .range(from, to),
  );
  return countAtsPlatforms(rows.map((row) => row.job_link));
}

export type ResumeDbApplicationsListQuery = {
  search?: string;
  dateFrom?: string; // YYYY-MM-DD
  dateTo?: string; // YYYY-MM-DD
  timeZone?: string;
  candidateFilter?: string; // "profile-{id}" | "name-{encodedName}"
  /** A platform name ("Greenhouse") or a hostname, as atsPlatformFromLink gives it. */
  atsPlatform?: string;
  /** Prefer denormalized stage filter over ID include/exclude scans. */
  pipelineStageId?: string | null;
  /** When true, only rows with pipeline_stage_id IS NULL (Registered). */
  pipelineStageIsNull?: boolean;
  statusIncludeIds?: number[]; // only these application ids (legacy fallback)
  statusExcludeIds?: number[]; // exclude these application ids (legacy fallback)
  /** Auto-bid states to keep; empty array matches nothing, undefined means no filter. */
  bidStates?: BidState[];
  sortKey?: ResumeDbSortKey | null;
  sortDir?: ResumeDbSortDir;
  page?: number; // 1-based
  pageSize?: number;
  /** Leave out the Note (whole job descriptions), for callers that never show it. */
  withoutNote?: boolean;
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
    const safe = search.replace(/[%_,*()]/g, " ").replace(/\s+/g, " ").trim();
    if (safe) {
      const pattern = `%${safe}%`;
      // Quote values so commas / reserved chars cannot break PostgREST .or() parsing.
      builder = builder.or(
        [
          `company.ilike."${pattern}"`,
          `job_title.ilike."${pattern}"`,
          `candidate_name.ilike."${pattern}"`,
          `job_link.ilike."${pattern}"`,
          `note.ilike."${pattern}"`,
          `apply.ilike."${pattern}"`,
          `entry_id.ilike."${pattern}"`,
        ].join(","),
      );
    }
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

  const atsPlatform = q.atsPlatform?.trim();
  if (atsPlatform) {
    // By the link itself, so bids registered before the platform was saved are found too.
    const patterns = atsPlatformLinkPatterns(atsPlatform);
    if (patterns.length === 0) builder = builder.eq("id", -1);
    else builder = builder.or(patterns.map((pattern) => `job_link.ilike."${pattern}"`).join(","));
  }

  if (q.pipelineStageIsNull) {
    builder = builder.is("pipeline_stage_id", null);
  } else if (q.pipelineStageId != null && q.pipelineStageId !== "") {
    builder = builder.eq("pipeline_stage_id", q.pipelineStageId);
  }

  if (q.statusIncludeIds) {
    if (q.statusIncludeIds.length === 0) builder = builder.eq("id", -1);
    else builder = builder.in("id", q.statusIncludeIds);
  }

  if (q.statusExcludeIds && q.statusExcludeIds.length > 0) {
    builder = builder.not("id", "in", `(${q.statusExcludeIds.join(",")})`);
  }

  if (q.bidStates) {
    if (q.bidStates.length === 0) builder = builder.eq("id", -1);
    else builder = builder.in("bid_state", q.bidStates);
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
  if (error) {
    if (
      /pipeline_stage_id/i.test(error.message) &&
      (query.pipelineStageIsNull || query.pipelineStageId)
    ) {
      throw new Error(error.message);
    }
    if (/pipeline_stage_id/i.test(error.message)) {
      // Column missing but not filtering by it — recount without stage predicates.
      let retry = supabase
        .from("resume_db_applications")
        .select("id", { count: "exact", head: true });
      retry = applyCommonFilters(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        supabase as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        retry as any,
        userId,
        {
          ...query,
          pipelineStageId: undefined,
          pipelineStageIsNull: false,
        },
      );
      const second = await retry;
      if (second.error) throw new Error(second.error.message);
      return second.count ?? 0;
    }
    throw new Error(error.message);
  }
  return count ?? 0;
}

/**
 * The table column behind each sort key. "pipeline" is absent on purpose: stage
 * order lives in pipeline_stages.sort_order and pipeline_stage_id carries no
 * foreign key to it, so PostgREST cannot order by it — the route sorts that key
 * in memory instead, over the loaded page only.
 */
const SORT_COLUMNS: Record<Exclude<ResumeDbSortKey, "pipeline">, string> = {
  company: "company",
  jobTitle: "job_title",
  applied: "applied_at",
  // Ordering the raw state happens to match the alphabetical order of the labels
  // in BID_STATE_LABELS, so the column reads the way it sorts. Renaming a label
  // can break that; renaming a state value cannot.
  bid: "bid_state",
};

/**
 * Orders a list query, always with `id DESC` behind the chosen key so equal values
 * keep a stable order and paging cannot repeat or skip a row. Keys this query
 * cannot order by fall back to that default rather than throwing: unlike a dropped
 * filter, a default order shows the right rows, just not in the asked-for order.
 */
function applySortOrder(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  builder: any,
  sortKey: ResumeDbSortKey | null,
  sortDir: ResumeDbSortDir,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  const column =
    sortKey && sortKey !== "pipeline" && !(sortKey === "bid" && bidStateColumnMissing)
      ? SORT_COLUMNS[sortKey]
      : null;
  if (!column) return builder.order("id", { ascending: false });
  return builder
    // nullsFirst: false keeps rows with no value — never applied, no bid row — at
    // the bottom whichever way the column is sorted, instead of flooding the top.
    .order(column, { ascending: sortDir === "asc", nullsFirst: false })
    .order("id", { ascending: false });
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

  const listColumns = query.withoutNote
    ? RESUME_DB_LIST_COLUMNS.replace("note, ", "")
    : RESUME_DB_LIST_COLUMNS;
  let selectColumns = listColumns;
  if (!atsPlatformColumnMissing) selectColumns += ", ats_platform";
  if (!bidStateColumnMissing) selectColumns += ", bid_state, bid_error";
  let builder = supabase.from("resume_db_applications").select(selectColumns);

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

  builder = applySortOrder(builder, sortKey, sortDir);

  let { data, error } = await builder.range(start, end);
  if (error && !atsPlatformColumnMissing && isMissingAtsPlatformColumn(error.message)) {
    // The column's script has not run: list without it; the platform is then
    // worked out from each job link.
    atsPlatformColumnMissing = true;
    return listApplicationsWithFilters(userId, query);
  }
  if (error && !bidStateColumnMissing && isMissingBidStateColumn(error.message)) {
    // Auto-bid's script has not run. Fail if the caller filtered by bid state
    // rather than silently returning rows the filter should have excluded.
    if (query.bidStates) throw new Error(error.message);
    bidStateColumnMissing = true;
    return listApplicationsWithFilters(userId, query);
  }
  if (error && /pipeline_stage_id/i.test(error.message)) {
    // Column missing: if the caller asked for a stage filter, fail so the route
    // can fall back to the legacy marker scan — never silently drop the filter.
    if (query.pipelineStageIsNull || query.pipelineStageId) {
      throw new Error(error.message);
    }
    let fallback = supabase
      .from("resume_db_applications")
      .select(listColumns.replace(", pipeline_stage_id", ""));
    fallback = applyCommonFilters(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fallback as any,
      userId,
      query,
    );
    fallback = applySortOrder(fallback, sortKey, sortDir);
    const retry = await fallback.range(start, end);
    data = retry.data;
    error = retry.error;
  }
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
    ...(input.jobDescription !== undefined && { job_description: input.jobDescription }),
    ...(input.generationStatus !== undefined && { generation_status: input.generationStatus }),
    ...(input.postedAt !== undefined && { posted_at: input.postedAt }),
  };

  const atsPlatform = input.atsPlatform?.trim() || atsPlatformFromLink(input.jobLink);
  const insert = (values: Record<string, unknown>) =>
    supabase.from("resume_db_applications").insert(values as never).select("*").single();

  let { data, error } = atsPlatformColumnMissing
    ? await insert(row)
    : await insert({ ...row, ats_platform: atsPlatform || null });
  if (error && !atsPlatformColumnMissing && isMissingAtsPlatformColumn(error.message)) {
    // The column's script has not run: register the bid without it.
    atsPlatformColumnMissing = true;
    ({ data, error } = await insert(row));
  }

  if (error) throw new Error(error.message);
  return mapRow(data as unknown as DbRow);
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
  if (input.pipelineStageId !== undefined) {
    patch.pipeline_stage_id = input.pipelineStageId;
  }
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

  const update = (values: Record<string, unknown>) =>
    supabase
      .from("resume_db_applications")
      .update(values as never)
      .eq("id", id)
      .eq("user_id", userId);

  // A changed link can mean a different platform.
  const withPlatform =
    input.atsPlatform !== undefined
      ? { ...patch, ats_platform: input.atsPlatform.trim() || null }
      : input.jobLink !== undefined
        ? { ...patch, ats_platform: atsPlatformFromLink(input.jobLink) || null }
        : null;

  let { error } =
    withPlatform && !atsPlatformColumnMissing ? await update(withPlatform) : await update(patch);
  if (error && withPlatform && !atsPlatformColumnMissing && isMissingAtsPlatformColumn(error.message)) {
    atsPlatformColumnMissing = true;
    ({ error } = await update(patch));
  }

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
