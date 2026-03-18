import { NextRequest, NextResponse } from "next/server";
import { parseJobDescriptionWithOpenAI, type JdParseInput } from "@/lib/jdParse";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const jobDescription = typeof body.jobDescription === "string" ? body.jobDescription : "";
    if (!jobDescription.trim()) {
      return NextResponse.json(
        { error: "Missing or empty jobDescription." },
        { status: 400 }
      );
    }

    const input: JdParseInput = {
      jobDescription: jobDescription.trim(),
      openaiApiKey: typeof body.openaiApiKey === "string" ? body.openaiApiKey : undefined,
      model: typeof body.model === "string" ? body.model : undefined,
    };

    const result = await parseJobDescriptionWithOpenAI(input);
    return NextResponse.json(result);
  } catch (error) {
    console.error("JD Parse API error:", error);

    let statusCode = 500;
    let errorMessage = "An unexpected error occurred";

    if (error instanceof Error) {
      errorMessage = error.message;
      if (
        error.message.includes("not available in your region") ||
        error.message.includes("access forbidden")
      ) {
        statusCode = 403;
      } else if (
        error.message.includes("OpenAI API key") ||
        error.message.includes("not set")
      ) {
        statusCode = 401;
      } else if (error.message.includes("rate limit")) {
        statusCode = 429;
      }
    }

    return NextResponse.json({ error: errorMessage }, { status: statusCode });
  }
}
