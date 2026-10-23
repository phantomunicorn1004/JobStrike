import JobsLayout from "@/app/jobs-layout";
import { MailAutoSync } from "@/components/settings/MailAutoSync";

/**
 * Shared member chrome. Keeps the sidebar mounted across member routes
 * so navigations do not remount JobsLayout on every page.
 */
export default function MemberLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <JobsLayout>
      <MailAutoSync />
      {children}
    </JobsLayout>
  );
}
