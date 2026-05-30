import { NextResponse } from "next/server";
import {
  ensureDefaultAdmin,
  verifyAppUserCredentials,
} from "@/lib/auth/repository";
import { normalizeUsername } from "@/lib/auth/constants";
import { setSessionCookie } from "@/lib/auth/session";

export async function POST(request: Request) {
  try {
    await ensureDefaultAdmin();
    const body = await request.json();
    const username = normalizeUsername(String(body.username ?? ""));
    const password = String(body.password ?? "");

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

    await setSessionCookie({
      id: user.id,
      username: user.username,
      role: user.role,
    });

    return NextResponse.json({
      user: { id: user.id, username: user.username, role: user.role },
    });
  } catch (error) {
    console.error("Login error:", error);
    return NextResponse.json({ error: "Login failed." }, { status: 500 });
  }
}
