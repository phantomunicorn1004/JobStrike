import { NextResponse } from "next/server";
import {
  createAppUser,
  ensureDefaultAdmin,
  findUserByUsername,
} from "@/lib/auth/repository";
import { normalizeUsername } from "@/lib/auth/constants";
import { setSessionCookie } from "@/lib/auth/session";

export async function POST(request: Request) {
  try {
    await ensureDefaultAdmin();
    const body = await request.json();
    const username = normalizeUsername(String(body.username ?? ""));
    const password = String(body.password ?? "");

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
      return NextResponse.json({ error: "Username is already taken." }, { status: 409 });
    }

    const user = await createAppUser({ username, password, role: "member" });

    await setSessionCookie({
      id: user.id,
      username: user.username,
      role: user.role,
    });

    return NextResponse.json({
      user: { id: user.id, username: user.username, role: user.role },
    });
  } catch (error) {
    console.error("Signup error:", error);
    if (error instanceof Error && error.message.includes("SUPABASE_SERVICE_ROLE_KEY")) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    return NextResponse.json({ error: "Sign up failed." }, { status: 500 });
  }
}
