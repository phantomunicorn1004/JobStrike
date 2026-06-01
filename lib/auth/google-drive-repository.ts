import "server-only";

import { getSupabaseServiceRoleClient } from "@/lib/supabase/admin";
import { normalizeGoogleDriveFolderId } from "@/lib/google-drive/urls";

export type UserGoogleDriveSettings = {
  refreshToken: string;
  googleEmail: string | null;
  folderId: string | null;
  defaultResumeUrl: string;
  defaultCoverUrl: string;
};

export type StoredGoogleOAuthCredentials = {
  clientId: string;
  clientSecret: string;
};

type GoogleRow = {
  google_refresh_token: string | null;
  google_email: string | null;
  google_drive_folder_id: string | null;
  default_resume_url: string | null;
  default_cover_url: string | null;
  google_oauth_client_id: string | null;
  google_oauth_client_secret: string | null;
};

export async function getUserGoogleOAuthCredentials(
  userId: string,
): Promise<StoredGoogleOAuthCredentials> {
  const supabase = getSupabaseServiceRoleClient();
  const { data, error } = await supabase
    .from("app_users")
    .select("google_oauth_client_id, google_oauth_client_secret")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;
  const row = (data as Pick<
    GoogleRow,
    "google_oauth_client_id" | "google_oauth_client_secret"
  > | null) ?? null;

  return {
    clientId: row?.google_oauth_client_id?.trim() || "",
    clientSecret: row?.google_oauth_client_secret?.trim() || "",
  };
}

export async function updateUserGoogleOAuthCredentials(
  userId: string,
  input: { clientId?: string; clientSecret?: string },
): Promise<void> {
  const supabase = getSupabaseServiceRoleClient();
  const patch: Record<string, string | null> = {
    updated_at: new Date().toISOString(),
  };
  if (input.clientId !== undefined) {
    patch.google_oauth_client_id = input.clientId.trim() || null;
  }
  if (input.clientSecret !== undefined) {
    patch.google_oauth_client_secret = input.clientSecret.trim() || null;
  }

  const { error } = await supabase
    .from("app_users")
    .update(patch as never)
    .eq("id", userId);

  if (error) throw error;
}

export async function getUserGoogleDriveConnection(
  userId: string,
): Promise<{
  refreshToken: string | null;
  googleEmail: string | null;
  folderId: string | null;
  defaultResumeUrl: string;
  defaultCoverUrl: string;
} | null> {
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
  return {
    refreshToken: row.google_refresh_token?.trim() || null,
    googleEmail: row.google_email,
    folderId: row.google_drive_folder_id?.trim() || null,
    defaultResumeUrl: row.default_resume_url?.trim() || "",
    defaultCoverUrl: row.default_cover_url?.trim() || "",
  };
}

export async function getUserGoogleDriveSettings(
  userId: string,
): Promise<UserGoogleDriveSettings | null> {
  const row = await getUserGoogleDriveConnection(userId);
  if (!row?.refreshToken) return null;

  return {
    refreshToken: row.refreshToken,
    googleEmail: row.googleEmail,
    folderId: row.folderId,
    defaultResumeUrl: row.defaultResumeUrl,
    defaultCoverUrl: row.defaultCoverUrl,
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
    const normalized = normalizeGoogleDriveFolderId(input.folderId);
    patch.google_drive_folder_id = normalized || null;
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
