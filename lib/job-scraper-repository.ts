import "server-only";

import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { normalizeCompanyName } from "@/lib/job-scraper";

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

export async function listDistinctResumeDbCompanies(userId: string): Promise<string[]> {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("resume_db_applications")
    .select("company")
    .eq("user_id", userId);

  if (error) throw new Error(error.message);

  const seen = new Set<string>();
  const result: string[] = [];
  for (const row of (data ?? []) as Array<{ company?: string | null }>) {
    const raw = row.company?.trim();
    const normalized = normalizeCompanyName(raw);
    if (!raw || !normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(raw);
  }
  return result.sort((a, b) => a.localeCompare(b));
}
