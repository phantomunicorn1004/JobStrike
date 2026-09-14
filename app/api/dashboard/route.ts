import { NextRequest } from "next/server";
import { corsJson, corsOptions } from "@/lib/api/extensionCors";
import {
  resolveRequestUser,
  unauthorizedJson,
} from "@/lib/auth/resolve-request-user";
import { loadDashboardData } from "@/lib/dashboard/load-dashboard";

export function OPTIONS() {
  return corsOptions();
}

export async function GET(request: NextRequest) {
  try {
    const user = await resolveRequestUser(request);
    if (!user) {
      return corsJson(unauthorizedJson(), { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const data = await loadDashboardData(user, {
      rangeMode: searchParams.get("rangeMode"),
      bidDays: searchParams.get("bidDays"),
      bidFrom: searchParams.get("bidFrom"),
      bidTo: searchParams.get("bidTo"),
      activityDate: searchParams.get("activityDate"),
      date: searchParams.get("date"),
    });

    return corsJson(data);
  } catch (error) {
    console.error("Dashboard stats error:", error);
    const message =
      error instanceof Error ? error.message : "Failed to load dashboard.";
    return corsJson({ error: message }, { status: 500 });
  }
}
