import React, { Suspense } from "react";
import { AutobidMonitorClient } from "@/components/autobid/AutobidMonitorClient";

export const dynamic = "force-dynamic";

export default function AutobidPage() {
  return (
    <Suspense fallback={<div className="p-6">Loading...</div>}>
      <AutobidMonitorClient />
    </Suspense>
  );
}
