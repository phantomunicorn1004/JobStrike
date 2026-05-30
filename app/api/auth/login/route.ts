import { NextResponse } from "next/server";
import { corsOptions } from "@/lib/api/extensionCors";
import {
  ensureExtensionApiKey,
  verifyAppUserCredentials,
} from "@/lib/auth/repository";
import { authFailureResponse, parseAuthCredentials } from "@/lib/auth/request";
import { createSessionJsonResponse } from "@/lib/auth/session";

export const runtime = "nodejs";

const EXTENSION_CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, X-Extension-Key, Authorization",
};

export function OPTIONS() {
  return corsOptions();
}

function withExtensionCors(response: NextResponse): NextResponse {
  for (const [key, value] of Object.entries(EXTENSION_CORS_HEADERS)) {
    response.headers.set(key, value);
  }
  return response;
}

export async function POST(request: Request) {
  try {
    const parsed = await parseAuthCredentials(request);
    if (parsed instanceof NextResponse) return withExtensionCors(parsed);

    const { username, password } = parsed;
    if (!username || !password) {
      return withExtensionCors(
        NextResponse.json(
          { error: "Username and password are required." },
          { status: 400 },
        ),
      );
    }

    const user = await verifyAppUserCredentials(username, password);
    if (!user) {
      return withExtensionCors(
        NextResponse.json({ error: "Invalid username or password." }, { status: 401 }),
      );
    }

    if (user.role === "admin") {
      return withExtensionCors(
        NextResponse.json(
          {
            error:
              "Administrator accounts cannot use the extension. Sign in with a member account.",
          },
          { status: 403 },
        ),
      );
    }

    const extensionApiKey = await ensureExtensionApiKey(user.id);

    return withExtensionCors(
      await createSessionJsonResponse(
        {
          user: { id: user.id, username: user.username, role: user.role },
          extensionApiKey,
        },
        { id: user.id, username: user.username, role: user.role },
      ),
    );
  } catch (error) {
    console.error("Login error:", error);
    return withExtensionCors(authFailureResponse(error, "Login failed."));
  }
}
