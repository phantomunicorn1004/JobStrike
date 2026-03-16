import { NextRequest, NextResponse } from "next/server";

/**
 * Secure download endpoint for resume files
 * Generates temporary download URLs for resume files
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const fileData = searchParams.get("data");
    const fileName = searchParams.get("fileName");
    const mimeType = searchParams.get("mimeType");

    if (!fileData || !fileName || !mimeType) {
      return NextResponse.json(
        { error: "Missing required parameters: data, fileName, mimeType" },
        { status: 400 }
      );
    }

    // Parse data URL if needed
    let fileBuffer: Buffer;
    let actualMimeType = mimeType;

    if (fileData.startsWith("data:")) {
      // Data URL format: data:mimeType;base64,data
      const matches = fileData.match(/^data:([^;]+);base64,(.+)$/);
      if (!matches) {
        return NextResponse.json(
          { error: "Invalid data URL format" },
          { status: 400 }
        );
      }
      actualMimeType = matches[1];
      const base64Data = matches[2];
      fileBuffer = Buffer.from(base64Data, "base64");
    } else {
      // Assume base64 encoded data
      fileBuffer = Buffer.from(fileData, "base64");
    }

    // Ensure Buffer is properly typed for NextResponse
    // Convert Buffer to Uint8Array for NextResponse compatibility
    const fileUint8Array = new Uint8Array(fileBuffer);

    // Return file with proper headers for download
    return new NextResponse(fileUint8Array, {
      headers: {
        "Content-Type": actualMimeType,
        "Content-Disposition": `attachment; filename="${encodeURIComponent(fileName)}"`,
        "Content-Length": fileBuffer.length.toString(),
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Pragma": "no-cache",
        "Expires": "0",
      },
    });
  } catch (error) {
    console.error("Resume download error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "An unexpected error occurred during download",
      },
      { status: 500 }
    );
  }
}
