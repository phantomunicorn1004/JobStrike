import "server-only";

import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { normalizeUsername, DEFAULT_ADMIN_USERNAME } from "@/lib/auth/constants";
import type { AppUser, UserRole } from "@/lib/auth/types";

type AppUserRow = {
  id: string;
  username: string;
  password_hash: string;
  role: UserRole;
  created_at: string;
  updated_at: string;
};

function mapRow(row: AppUserRow): AppUser {
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function findUserByUsername(
  username: string,
): Promise<AppUserRow | null> {
  const supabase = getSupabaseAdminClient();
  const normalized = normalizeUsername(username);
  const { data, error } = await supabase
    .from("app_users")
    .select("*")
    .eq("username", normalized)
    .maybeSingle();
  if (error) throw error;
  return (data as AppUserRow | null) ?? null;
}

export async function findUserById(id: string): Promise<AppUser | null> {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("app_users")
    .select("id, username, role, created_at, updated_at")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data ? mapRow(data as AppUserRow) : null;
}

export async function listAppUsers(): Promise<AppUser[]> {
  const supabase = getSupabaseAdminClient();
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
  const supabase = getSupabaseAdminClient();
  const username = normalizeUsername(input.username);
  const password_hash = await hashPassword(input.password);
  const role = input.role ?? "member";
  const { data, error } = await supabase
    .from("app_users")
    .insert({ username, password_hash, role } as never)
    .select("id, username, role, created_at, updated_at")
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

export async function updateAppUser(
  id: string,
  input: { username?: string; password?: string; role?: UserRole },
): Promise<AppUser> {
  const supabase = getSupabaseAdminClient();
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
  const { data, error } = await supabase
    .from("app_users")
    .update(patch as never)
    .eq("id", id)
    .select("id, username, role, created_at, updated_at")
    .single();
  if (error) throw error;
  return mapRow(data as AppUserRow);
}

export async function deleteAppUser(id: string): Promise<void> {
  const supabase = getSupabaseAdminClient();
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
