import JobsLayout from "@/app/jobs-layout";

/**
 * Shared member chrome. Keeps the sidebar mounted across member routes
 * so navigations do not remount JobsLayout on every page.
 */
export default function MemberLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <JobsLayout>{children}</JobsLayout>;
}
