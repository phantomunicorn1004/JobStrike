import React, { Suspense } from "react";
import { redirect } from "next/navigation";
import { DashboardPageClient } from "@/components/dashboard/DashboardPageClient";
import { getSessionUser } from "@/lib/auth/session";
import { findUserById } from "@/lib/auth/repository";
import { loadDashboardData } from "@/lib/dashboard/load-dashboard";
import { DEFAULT_TIMEZONE } from "@/lib/timezone";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await getSessionUser();
  if (!session || session.role !== "member") {
    redirect("/login");
  }

  const fresh = await findUserById(session.id);
  const user = {
    id: session.id,
    username: session.username,
    role: session.role,
    timezone: fresh?.timezone || session.timezone || DEFAULT_TIMEZONE,
  };

  let initialData = null;
  try {
    initialData = await loadDashboardData(user, { rangeMode: "month" });
  } catch (error) {
    console.error("Dashboard SSR load failed:", error);
  }

  return (
    <Suspense fallback={<div className="p-6">Loading dashboard…</div>}>
      <DashboardPageClient initialData={initialData} />
    </Suspense>
  );
}
