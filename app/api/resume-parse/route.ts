import { NextRequest, NextResponse } from "next/server";
import { parseResume } from "@/lib/resume/parseResume";

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const result = await parseResume(file, {
      maxFileSize: 5 * 1024 * 1024, // 5MB limit
    });

    return NextResponse.json({
      text: result.text,
      fileType: result.fileType,
    });
  } catch (error) {
    console.error("Resume parse API error:", error);

    const errorMessage =
      error instanceof Error
        ? error.message
        : "An unexpected error occurred while parsing the file";

    const statusCode = errorMessage.includes("Unsupported") ||
      errorMessage.includes("validation") ||
      errorMessage.includes("size")
      ? 400
      : 500;

    return NextResponse.json({ error: errorMessage }, { status: statusCode });
  }
}
