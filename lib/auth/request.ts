import { NextResponse } from "next/server";
import { normalizeUsername } from "@/lib/auth/constants";

export type AuthCredentials = {
  username: string;
  password: string;
};

export async function parseAuthCredentials(
  request: Request,
): Promise<AuthCredentials | NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const record = body as Record<string, unknown>;
  return {
    username: normalizeUsername(String(record.username ?? "")),
    password: String(record.password ?? ""),
  };
}

export function authFailureResponse(
  error: unknown,
  fallback: string,
): NextResponse {
  if (error instanceof Error) {
    if (error.message.includes("SUPABASE_SERVICE_ROLE_KEY")) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
  }
  return NextResponse.json({ error: fallback }, { status: 500 });
}
