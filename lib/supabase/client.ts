import { createBrowserClient } from "@supabase/ssr"

/**
 * Browser-only Supabase client
 * This function MUST only be called from client components ("use client")
 * Do NOT import or use this in server components or API routes
 */
let client: ReturnType<typeof createBrowserClient> | null = null

export function getSupabaseBrowserClient() {
  // Return cached client if available
  if (client) {
    return client
  }

  // Validate environment variables at runtime (client-side)
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "Missing Supabase environment variables. Please ensure NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are set."
    )
  }

  // Create browser client (only runs in browser, never during build)
  client = createBrowserClient(supabaseUrl, supabaseAnonKey)

  return client
}
