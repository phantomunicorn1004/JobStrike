import JobsLayout from "../jobs-layout";

// Force dynamic rendering to prevent static prerendering
// Profile layout wraps Supabase-dependent components requiring request-time rendering
export const dynamic = "force-dynamic";

export default function ProfileLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <JobsLayout>{children}</JobsLayout>;
}
