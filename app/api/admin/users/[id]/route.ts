import { NextResponse } from "next/server";
import {
  deleteAppUser,
  findUserById,
  updateAppUser,
} from "@/lib/auth/repository";
import { normalizeUsername } from "@/lib/auth/constants";
import { getSessionUser, requireAdminUser } from "@/lib/auth/session";
import type { UserRole } from "@/lib/auth/types";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  try {
    await requireAdminUser();
    const { id } = await context.params;
    const body = await request.json();

    const target = await findUserById(id);
    if (!target) {
      return NextResponse.json({ error: "User not found." }, { status: 404 });
    }

    const username =
      body.username !== undefined
        ? normalizeUsername(String(body.username))
        : undefined;
    const password =
      body.password !== undefined ? String(body.password) : undefined;
    const role =
      body.role !== undefined ? (String(body.role) as UserRole) : undefined;

    if (username !== undefined && username.length < 3) {
      return NextResponse.json(
        { error: "Username must be at least 3 characters." },
        { status: 400 },
      );
    }
    if (password !== undefined && password.length > 0 && password.length < 8) {
      return NextResponse.json(
        { error: "Password must be at least 8 characters." },
        { status: 400 },
      );
    }
    if (role !== undefined && role !== "admin" && role !== "member") {
      return NextResponse.json({ error: "Invalid role." }, { status: 400 });
    }

    const user = await updateAppUser(id, {
      username,
      password: password || undefined,
      role,
    });

    return NextResponse.json({ user });
  } catch (error) {
    console.error("Update user error:", error);
    const message = error instanceof Error ? error.message : "Forbidden";
    const status =
      message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 500;
    return NextResponse.json({ error: "Failed to update user." }, { status });
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    await requireAdminUser();
    const session = await getSessionUser();
    const { id } = await context.params;

    if (session?.id === id) {
      return NextResponse.json(
        { error: "You cannot delete your own account." },
        { status: 400 },
      );
    }

    const target = await findUserById(id);
    if (!target) {
      return NextResponse.json({ error: "User not found." }, { status: 404 });
    }

    await deleteAppUser(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Delete user error:", error);
    const message = error instanceof Error ? error.message : "Forbidden";
    const status =
      message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 500;
    return NextResponse.json({ error: "Failed to delete user." }, { status });
  }
}
