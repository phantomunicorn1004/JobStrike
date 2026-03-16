import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

/**
 * Check if user is authenticated with Google Drive
 */
export async function GET(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const accessToken = cookieStore.get("google_drive_access_token")?.value;

    if (!accessToken) {
      return NextResponse.json({ authenticated: false });
    }

    // Optionally verify token is still valid by making a test API call
    // For now, just check if token exists
    return NextResponse.json({ authenticated: true });
  } catch (error) {
    console.error("Check auth error:", error);
    return NextResponse.json({ authenticated: false });
  }
}
