import React, { Suspense } from "react";
import { DashboardPageClient } from "@/components/dashboard/DashboardPageClient";

export const dynamic = "force-dynamic";

export default function DashboardPage() {
  return (
    <Suspense fallback={<div className="p-6">Loading dashboard…</div>}>
      <DashboardPageClient />
    </Suspense>
  );
}
