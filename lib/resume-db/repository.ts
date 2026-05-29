import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import type {
  ProfileListItem,
  ResumeDbApplication,
  ResumeDbApplicationInput,
} from "@/lib/resume-db/types";

type DbRow = {
  id: number;
  entry_id: string;
  profile_id: number | null;
  candidate_name: string;
  job_link: string;
  job_title: string;
  company: string;
  apply: string;
  resume_url: string;
  cover_letter_url: string;
  applied_at: string;
  created_at: string;
  pipeline_job_id: number | null;
  resume_storage_path: string | null;
  cover_letter_storage_path: string | null;
};

function mapRow(row: DbRow): ResumeDbApplication {
  return {
    id: row.id,
    entryId: row.entry_id,
    profileId: row.profile_id,
    candidateName: row.candidate_name,
    jobLink: row.job_link,
    jobTitle: row.job_title,
    company: row.company,
    apply: row.apply,
    resumeUrl: row.resume_url,
    coverLetterUrl: row.cover_letter_url ?? "",
    appliedAt: row.applied_at,
    createdAt: row.created_at,
    pipelineJobId: row.pipeline_job_id ?? null,
    resumeStoragePath: row.resume_storage_path ?? null,
    coverLetterStoragePath: row.cover_letter_storage_path ?? null,
  };
}

export async function listProfiles(): Promise<ProfileListItem[]> {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name")
    .order("full_name", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as ProfileListItem[];
}

export async function listApplications(): Promise<ResumeDbApplication[]> {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("resume_db_applications")
    .select("*")
    .order("id", { ascending: false });

  if (error) throw new Error(error.message);
  return ((data ?? []) as DbRow[]).map(mapRow);
}

export async function getApplicationById(
  id: number,
): Promise<ResumeDbApplication | null> {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("resume_db_applications")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;
  return mapRow(data as DbRow);
}

export async function createApplication(
  input: ResumeDbApplicationInput,
): Promise<ResumeDbApplication> {
  const supabase = getSupabaseAdminClient();
  const row = {
    entry_id: input.entryId,
    profile_id: input.profileId ?? null,
    candidate_name: input.candidateName,
    job_link: input.jobLink,
    job_title: input.jobTitle,
    company: input.company,
    apply: input.apply ?? "Registered",
    resume_url: input.resumeUrl,
    cover_letter_url: input.coverLetterUrl ?? "",
    resume_storage_path: input.resumeStoragePath ?? null,
    cover_letter_storage_path: input.coverLetterStoragePath ?? null,
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
  input: Partial<ResumeDbApplicationInput>,
): Promise<void> {
  const supabase = getSupabaseAdminClient();
  const patch: Record<string, unknown> = {};
  if (input.profileId !== undefined) patch.profile_id = input.profileId;
  if (input.candidateName !== undefined) patch.candidate_name = input.candidateName;
  if (input.jobLink !== undefined) patch.job_link = input.jobLink;
  if (input.jobTitle !== undefined) patch.job_title = input.jobTitle;
  if (input.company !== undefined) patch.company = input.company;
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

  const { error } = await supabase
    .from("resume_db_applications")
    .update(patch as never)
    .eq("id", id);

  if (error) throw new Error(error.message);
}

export async function deleteApplication(id: number): Promise<void> {
  const supabase = getSupabaseAdminClient();
  const { error } = await supabase
    .from("resume_db_applications")
    .delete()
    .eq("id", id);

  if (error) throw new Error(error.message);
}
