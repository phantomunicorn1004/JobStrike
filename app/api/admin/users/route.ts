import { NextResponse } from "next/server";
import { listAppUsers } from "@/lib/auth/repository";
import { requireAdminUser } from "@/lib/auth/session";

export async function GET() {
  try {
    await requireAdminUser();
    const users = await listAppUsers();
    return NextResponse.json({ users });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Forbidden";
    const status = message === "Unauthorized" ? 401 : 403;
    return NextResponse.json({ error: message }, { status });
  }
}
