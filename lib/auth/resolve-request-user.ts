import "server-only";

import type { NextRequest } from "next/server";
import {
  DEFAULT_RESUME_DB_OWNER_USERNAME,
} from "@/lib/auth/constants";
import {
  findUserByExtensionApiKey,
  findUserByUsername,
} from "@/lib/auth/repository";
import { getSessionUser } from "@/lib/auth/session";
import type { SessionUser } from "@/lib/auth/types";

function toSessionUser(user: {
  id: string;
  username: string;
  role: SessionUser["role"];
}): SessionUser {
  return { id: user.id, username: user.username, role: user.role };
}

async function defaultExtensionOwner(): Promise<SessionUser | null> {
  const row = await findUserByUsername(DEFAULT_RESUME_DB_OWNER_USERNAME);
  return row ? toSessionUser(row) : null;
}

/** Website session (member) or extension API key → app user. */
export async function resolveRequestUser(
  request?: NextRequest | Request,
): Promise<SessionUser | null> {
  const session = await getSessionUser();
  if (session?.role === "member") return session;

  const envKey = process.env.EXTENSION_API_KEY?.trim();
  const providedKey = request?.headers.get("x-extension-key")?.trim();

  if (providedKey) {
    const byKey = await findUserByExtensionApiKey(providedKey);
    if (byKey) return toSessionUser(byKey);
    if (envKey && providedKey === envKey) {
      return defaultExtensionOwner();
    }
    return null;
  }

  if (!envKey) {
    return defaultExtensionOwner();
  }

  return null;
}

export async function requireRequestUser(
  request?: NextRequest | Request,
): Promise<SessionUser> {
  const user = await resolveRequestUser(request);
  if (!user) {
    throw new Error("Unauthorized");
  }
  return user;
}

export function unauthorizedJson() {
  return { error: "Unauthorized. Sign in or provide a valid X-Extension-Key." };
}
