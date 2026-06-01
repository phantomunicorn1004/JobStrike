import "server-only";

import { getSupabaseServiceRoleClient } from "@/lib/supabase/admin";

export type UserGoogleDriveSettings = {
  refreshToken: string;
  googleEmail: string | null;
  folderId: string | null;
  defaultResumeUrl: string;
  defaultCoverUrl: string;
};

type GoogleRow = {
  google_refresh_token: string | null;
  google_email: string | null;
  google_drive_folder_id: string | null;
  default_resume_url: string | null;
  default_cover_url: string | null;
};

export async function getUserGoogleDriveSettings(
  userId: string,
): Promise<UserGoogleDriveSettings | null> {
  const supabase = getSupabaseServiceRoleClient();
  const { data, error } = await supabase
    .from("app_users")
    .select(
      "google_refresh_token, google_email, google_drive_folder_id, default_resume_url, default_cover_url",
    )
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const row = data as GoogleRow;
  if (!row.google_refresh_token?.trim()) return null;

  return {
    refreshToken: row.google_refresh_token.trim(),
    googleEmail: row.google_email,
    folderId: row.google_drive_folder_id?.trim() || null,
    defaultResumeUrl: row.default_resume_url?.trim() || "",
    defaultCoverUrl: row.default_cover_url?.trim() || "",
  };
}

export async function saveUserGoogleDriveConnection(
  userId: string,
  input: {
    refreshToken: string;
    googleEmail?: string | null;
  },
): Promise<void> {
  const supabase = getSupabaseServiceRoleClient();
  const { error } = await supabase
    .from("app_users")
    .update({
      google_refresh_token: input.refreshToken,
      google_email: input.googleEmail ?? null,
      google_token_updated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as never)
    .eq("id", userId);

  if (error) throw error;
}

export async function clearUserGoogleDriveConnection(
  userId: string,
): Promise<void> {
  const supabase = getSupabaseServiceRoleClient();
  const { error } = await supabase
    .from("app_users")
    .update({
      google_refresh_token: null,
      google_email: null,
      google_token_updated_at: null,
      updated_at: new Date().toISOString(),
    } as never)
    .eq("id", userId);
    

  if (error) throw error;
}

export async function updateUserGoogleDrivePreferences(
  userId: string,
  input: {
    folderId?: string;
    defaultResumeUrl?: string;
    defaultCoverUrl?: string;
  },
): Promise<void> {
  const supabase = getSupabaseServiceRoleClient();
  const patch: Record<string, string | null> = {
    updated_at: new Date().toISOString(),
  };
  if (input.folderId !== undefined) {
    patch.google_drive_folder_id = input.folderId.trim() || null;
  }
  if (input.defaultResumeUrl !== undefined) {
    patch.default_resume_url = input.defaultResumeUrl.trim();
  }
  if (input.defaultCoverUrl !== undefined) {
    patch.default_cover_url = input.defaultCoverUrl.trim();
  }

  const { error } = await supabase
    .from("app_users")
    .update(patch as never)
    .eq("id", userId);

  if (error) throw error;
}
