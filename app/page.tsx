import JobsLayout from "./jobs-layout";
import JobsAppliedPage from "./jobs-applied";

// Force dynamic rendering to prevent static prerendering
// Home page renders Supabase-dependent components requiring request-time rendering
export const dynamic = "force-dynamic";

export default function Home() {
  return (
    <JobsLayout>
      <JobsAppliedPage />
    </JobsLayout>
  );
}
