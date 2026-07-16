import "server-only";

import { randomBytes } from "node:crypto";
import { getSupabaseServiceRoleClient } from "@/lib/supabase/admin";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { normalizeUsername, DEFAULT_ADMIN_USERNAME } from "@/lib/auth/constants";
import type { AppUser, UserRole } from "@/lib/auth/types";
import { DEFAULT_TIMEZONE, normalizeTimeZone } from "@/lib/timezone";

type AppUserRow = {
  id: string;
  username: string;
  password_hash: string;
  role: UserRole;
  timezone: string | null;
  extension_api_key: string | null;
  created_at: string;
  updated_at: string;
};

function mapRow(row: AppUserRow): AppUser {
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    timezone: normalizeTimeZone(row.timezone),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function findUserByUsername(
  username: string,
): Promise<AppUserRow | null> {
  const supabase = getSupabaseServiceRoleClient();
  const normalized = normalizeUsername(username);
  const { data, error } = await supabase
    .from("app_users")
    .select("*")
    .eq("username", normalized)
    .maybeSingle();
  if (error) throw error;
  return (data as AppUserRow | null) ?? null;
}

export async function findUserByExtensionApiKey(
  apiKey: string,
): Promise<AppUser | null> {
  const supabase = getSupabaseServiceRoleClient();
  const key = apiKey.trim();
  if (!key) return null;
  const { data, error } = await supabase
    .from("app_users")
    .select("id, username, role, created_at, updated_at")
    .eq("extension_api_key", key)
    .maybeSingle();
  if (error) throw error;
  return data ? mapRow(data as AppUserRow) : null;
}

export async function findUserById(id: string): Promise<AppUser | null> {
  const supabase = getSupabaseServiceRoleClient();
  const { data, error } = await supabase
    .from("app_users")
    .select("id, username, role, created_at, updated_at")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data ? mapRow(data as AppUserRow) : null;
}

export async function listAppUsers(): Promise<AppUser[]> {
  const supabase = getSupabaseServiceRoleClient();
  const { data, error } = await supabase
    .from("app_users")
    .select("id, username, role, created_at, updated_at")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as AppUserRow[]).map(mapRow);
}

export async function createAppUser(input: {
  username: string;
  password: string;
  role?: UserRole;
}): Promise<AppUser> {
  const supabase = getSupabaseServiceRoleClient();
  const username = normalizeUsername(input.username);
  const password_hash = await hashPassword(input.password);
  const role = input.role ?? "member";
  const extension_api_key = randomBytes(24).toString("hex");
  const { data, error } = await supabase
    .from("app_users")
    .insert({
      username,
      password_hash,
      role,
      extension_api_key,
      timezone: DEFAULT_TIMEZONE,
    } as never)
    .select("id, username, role, timezone, created_at, updated_at")
    .single();
  if (error) throw error;
  return mapRow(data as AppUserRow);
}

export async function verifyAppUserCredentials(
  username: string,
  password: string,
): Promise<AppUser | null> {
  const row = await findUserByUsername(username);
  if (!row) return null;
  const ok = await verifyPassword(password, row.password_hash);
  if (!ok) return null;
  return mapRow(row);
}

/** Ensures every member has a per-user extension API key (legacy rows may be null). */
export async function ensureExtensionApiKey(userId: string): Promise<string> {
  const supabase = getSupabaseServiceRoleClient();
  const { data, error } = await supabase
    .from("app_users")
    .select("extension_api_key")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;

  const row = data as { extension_api_key: string | null } | null;
  const existing = row?.extension_api_key?.trim();
  if (existing) return existing;

  const extension_api_key = randomBytes(24).toString("hex");
  const { error: updateError } = await supabase
    .from("app_users")
    .update({ extension_api_key, updated_at: new Date().toISOString() } as never)
    .eq("id", userId);
  if (updateError) throw updateError;
  return extension_api_key;
}

export async function updateAppUser(
  id: string,
  input: { username?: string; password?: string; role?: UserRole; timezone?: string },
): Promise<AppUser> {
  const supabase = getSupabaseServiceRoleClient();
  const patch: Record<string, string> = {
    updated_at: new Date().toISOString(),
  };
  if (input.username !== undefined) {
    patch.username = normalizeUsername(input.username);
  }
  if (input.password) {
    patch.password_hash = await hashPassword(input.password);
  }
  if (input.role !== undefined) {
    patch.role = input.role;
  }
  if (input.timezone !== undefined) {
    patch.timezone = normalizeTimeZone(input.timezone);
  }
  const { data, error } = await supabase
    .from("app_users")
    .update(patch as never)
    .eq("id", id)
    .select("id, username, role, timezone, created_at, updated_at")
    .single();
  if (error) throw error;
  return mapRow(data as AppUserRow);
}

export async function deleteAppUser(id: string): Promise<void> {
  const supabase = getSupabaseServiceRoleClient();
  const { error } = await supabase.from("app_users").delete().eq("id", id);
  if (error) throw error;
}

/** Ensures default administrator exists (idempotent). */
export async function ensureDefaultAdmin(): Promise<void> {
  const existing = await findUserByUsername(DEFAULT_ADMIN_USERNAME);
  if (existing) return;

  const password =
    process.env.DEFAULT_ADMIN_PASSWORD?.trim() ||
    (process.env.NODE_ENV !== "production" ? "xvcsfdWRE@$#234" : "");
  if (!password) {
    console.warn(
      "DEFAULT_ADMIN_PASSWORD not set; skipping auto-create of default admin.",
    );
    return;
  }

  await createAppUser({
    username: DEFAULT_ADMIN_USERNAME,
    password,
    role: "admin",
  });
}
