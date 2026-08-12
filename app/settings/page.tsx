"use client";

import JobsLayout from "@/app/jobs-layout";
import { GoogleDriveSettingsCard } from "@/components/settings/GoogleDriveSettingsCard";
import { Json2DocxSettingsCard } from "@/components/settings/Json2DocxSettingsCard";
import { TimezoneSettingsCard } from "@/components/settings/TimezoneSettingsCard";
import { Suspense } from "react";

export default function SettingsPage() {
  return (
    <JobsLayout>
      <div className="mx-auto max-w-2xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
          <p className="text-sm text-muted-foreground">
            Connect integrations used by the website and Chrome extension.
          </p>
        </div>
        <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
          <TimezoneSettingsCard />
        </Suspense>
        <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
          <GoogleDriveSettingsCard />
        </Suspense>
        <Json2DocxSettingsCard />
      </div>
    </JobsLayout>
  );
}
