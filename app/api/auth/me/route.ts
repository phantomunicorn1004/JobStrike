import { NextRequest } from "next/server";
import { corsJson, corsOptions } from "@/lib/api/extensionCors";
import { resolveRequestUser } from "@/lib/auth/resolve-request-user";

export function OPTIONS() {
  return corsOptions();
}

export async function GET(request: NextRequest) {
  const user = await resolveRequestUser(request);
  if (!user) {
    return corsJson({ user: null }, { status: 401 });
  }
  return corsJson({ user });
}
