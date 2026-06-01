import { NextRequest } from "next/server";
import { corsJson, corsOptions } from "@/lib/api/extensionCors";
import { requireRequestUser } from "@/lib/auth/resolve-request-user";
import { clearUserGoogleDriveConnection } from "@/lib/auth/google-drive-repository";

export function OPTIONS() {
  return corsOptions();
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireRequestUser(request);
    await clearUserGoogleDriveConnection(user.id);
    return corsJson({ ok: true });
  } catch (error) {
    console.error("Google Drive disconnect error:", error);
    const message = error instanceof Error ? error.message : "Disconnect failed.";
    const status = message === "Unauthorized" ? 401 : 500;
    return corsJson({ error: message }, { status });
  }
}
