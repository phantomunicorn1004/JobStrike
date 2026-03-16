import JobsLayout from "../jobs-layout";
import JobsTechnicalPage from "../jobs-technical";

// Force dynamic rendering to prevent static prerendering
// Pages rendering Supabase-dependent components require request-time rendering
export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <JobsLayout>
      <JobsTechnicalPage />
    </JobsLayout>
  );
}
