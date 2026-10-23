import "server-only";

import { NextResponse } from "next/server";
import { resolveRequestUser, unauthorizedJson } from "@/lib/auth/resolve-request-user";

/**
 * For routes that only need "someone is signed in" (session or extension key): the AI and file
 * routes, which spend the server's OpenAI key. Returns a 401 response to send, or null to go on.
 */
export async function rejectIfSignedOut(request: Request): Promise<NextResponse | null> {
  const user = await resolveRequestUser(request);
  return user ? null : NextResponse.json(unauthorizedJson(), { status: 401 });
}
