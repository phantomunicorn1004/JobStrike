import "server-only";

import { createClient } from "@supabase/supabase-js";

let adminClient: ReturnType<typeof createClient> | null = null;
let serviceRoleClient: ReturnType<typeof createClient> | null = null;

function getSupabaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!url) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL. Add it to .env.local and restart the dev server.",
    );
  }
  return url;
}

/**
 * Server-side client with the service role. The anon key is never used on the server: row-level
 * security denies it everything (scripts/lock-down-row-level-security.sql), and all data access
 * goes through API routes that check the user.
 */
export function getSupabaseAdminClient() {
  if (adminClient) return adminClient;

  const url = getSupabaseUrl();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!key) {
    throw new Error(
      "Missing Supabase env: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
    );
  }

  adminClient = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return adminClient;
}

/** Service role client required for app_users auth (RLS blocks anon access). */
export function getSupabaseServiceRoleClient() {
  if (serviceRoleClient) return serviceRoleClient;

  const url = getSupabaseUrl();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!serviceKey) {
    throw new Error(
      "Missing SUPABASE_SERVICE_ROLE_KEY. User login requires the service role key in .env.local — restart the dev server after adding it.",
    );
  }

  serviceRoleClient = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return serviceRoleClient;
}
