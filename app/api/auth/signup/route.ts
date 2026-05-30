import { NextResponse } from "next/server";
import {
  createAppUser,
  ensureDefaultAdmin,
  findUserByUsername,
  verifyAppUserCredentials,
} from "@/lib/auth/repository";
import { authFailureResponse, parseAuthCredentials } from "@/lib/auth/request";
import { createSessionJsonResponse } from "@/lib/auth/session";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    try {
      await ensureDefaultAdmin();
    } catch (error) {
      console.warn("ensureDefaultAdmin skipped:", error);
    }

    const parsed = await parseAuthCredentials(request);
    if (parsed instanceof NextResponse) return parsed;

    const { username, password } = parsed;
    if (!username || username.length < 3) {
      return NextResponse.json(
        { error: "Username must be at least 3 characters." },
        { status: 400 },
      );
    }
    if (!password || password.length < 8) {
      return NextResponse.json(
        { error: "Password must be at least 8 characters." },
        { status: 400 },
      );
    }

    const existing = await findUserByUsername(username);
    if (existing) {
      const user = await verifyAppUserCredentials(username, password);
      if (user) {
        return createSessionJsonResponse(
          {
            user: { id: user.id, username: user.username, role: user.role },
            existing: true,
          },
          { id: user.id, username: user.username, role: user.role },
        );
      }
      return NextResponse.json({ error: "Username is already taken." }, { status: 409 });
    }

    const user = await createAppUser({ username, password, role: "member" });

    return createSessionJsonResponse(
      { user: { id: user.id, username: user.username, role: user.role } },
      { id: user.id, username: user.username, role: user.role },
    );
  } catch (error) {
    console.error("Signup error:", error);
    return authFailureResponse(error, "Sign up failed.");
  }
}
