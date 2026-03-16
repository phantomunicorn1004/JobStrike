import JobsLayout from "../jobs-layout";
import JobsAppliedPage from "../jobs-applied";

// Force dynamic rendering to prevent static prerendering
// Supabase SSR client requires request context (cookies, env vars)
export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <JobsLayout>
      <JobsAppliedPage />
    </JobsLayout>
  );
}
