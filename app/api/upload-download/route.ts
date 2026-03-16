import { NextRequest, NextResponse } from "next/server";

/**
 * Main API route for Step 7: Upload & Download
 * Handles resume download.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { downloadUrl, fileName, fileType } = body;

    if (!downloadUrl || !fileName || !fileType) {
      return NextResponse.json(
        {
          error: "Missing required fields: downloadUrl, fileName, fileType",
        },
        { status: 400 }
      );
    }

    return NextResponse.json({ downloadUrl });
  } catch (error) {
    console.error("Upload download API error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "An unexpected error occurred",
      },
      { status: 500 }
    );
  }
}
