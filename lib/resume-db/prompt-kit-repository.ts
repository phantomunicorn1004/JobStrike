import "server-only";

import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { DEFAULT_PROMPT_TEMPLATE } from "@/lib/promptBuilder";
import type { ProfilePromptKit } from "@/lib/resume-builder/promptKitStorage";
import { emptyProfilePromptKit } from "@/lib/resume-builder/promptKitStorage";
import { getProfileById } from "@/lib/resume-db/repository";

type PromptKitRow = {
  profile_id: number;
  user_id: string;
  prompt_template: string;
  resume_template_json: string;
  job_description: string;
  output: string;
  created_at: string;
  updated_at: string;
};

function mapRow(row: PromptKitRow): ProfilePromptKit {
  return emptyProfilePromptKit({
    template: row.prompt_template || DEFAULT_PROMPT_TEMPLATE,
    resumeTemplateJson: row.resume_template_json ?? "",
    jobDescription: row.job_description ?? "",
    output: row.output ?? "",
    updatedAt: row.updated_at ?? null,
  });
}

export type ProfilePromptKitResult = {
  kit: ProfilePromptKit;
  exists: boolean;
};

export async function getProfilePromptKit(
  userId: string,
  profileId: number,
): Promise<ProfilePromptKitResult> {
  const profile = await getProfileById(userId, profileId);
  if (!profile) {
    throw new Error("Profile not found");
  }

  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("profile_prompt_kits")
    .select("*")
    .eq("profile_id", profileId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) {
    return { kit: emptyProfilePromptKit(), exists: false };
  }
  return { kit: mapRow(data as PromptKitRow), exists: true };
}

export async function upsertProfilePromptKit(
  userId: string,
  profileId: number,
  kit: ProfilePromptKit,
): Promise<ProfilePromptKit> {
  const profile = await getProfileById(userId, profileId);
  if (!profile) {
    throw new Error("Profile not found");
  }

  const now = new Date().toISOString();
  const row = {
    profile_id: profileId,
    user_id: userId,
    prompt_template: kit.template ?? DEFAULT_PROMPT_TEMPLATE,
    resume_template_json: kit.resumeTemplateJson ?? "",
    job_description: kit.jobDescription ?? "",
    output: kit.output ?? "",
    updated_at: now,
  };

  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("profile_prompt_kits")
    .upsert(row as never, { onConflict: "profile_id" })
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return mapRow(data as PromptKitRow);
}
