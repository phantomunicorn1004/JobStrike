import { NextResponse } from "next/server";
import { verifyAppUserCredentials } from "@/lib/auth/repository";
import { authFailureResponse, parseAuthCredentials } from "@/lib/auth/request";
import { createSessionJsonResponse } from "@/lib/auth/session";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const parsed = await parseAuthCredentials(request);
    if (parsed instanceof NextResponse) return parsed;

    const { username, password } = parsed;
    if (!username || !password) {
      return NextResponse.json(
        { error: "Username and password are required." },
        { status: 400 },
      );
    }

    const user = await verifyAppUserCredentials(username, password);
    if (!user) {
      return NextResponse.json({ error: "Invalid username or password." }, { status: 401 });
    }

    return createSessionJsonResponse(
      { user: { id: user.id, username: user.username, role: user.role } },
      { id: user.id, username: user.username, role: user.role },
    );
  } catch (error) {
    console.error("Login error:", error);
    return authFailureResponse(error, "Login failed.");
  }
}
