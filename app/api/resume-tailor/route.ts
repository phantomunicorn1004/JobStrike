import { NextRequest, NextResponse } from "next/server";
import { tailorResumeWithOpenAI, type TailorResumeInput } from "@/lib/resumeTailor";

export async function POST(request: NextRequest) {
  try {
    const body: TailorResumeInput = await request.json();

    // Validate input
    if (!body.jobTitle || !body.jobDescription || !body.resumeText) {
      return NextResponse.json(
        { error: "Missing required fields: jobTitle, jobDescription, resumeText" },
        { status: 400 }
      );
    }

    // Call OpenAI service
    const result = await tailorResumeWithOpenAI(body);

    return NextResponse.json(result);
  } catch (error) {
    console.error("Resume tailor API error:", error);
    
    // Determine appropriate status code based on error type
    let statusCode = 500;
    let errorMessage = "An unexpected error occurred";
    
    if (error instanceof Error) {
      errorMessage = error.message;
      
      // Set appropriate status codes for different error types
      if (error.message.includes("not available in your region") || error.message.includes("access forbidden")) {
        statusCode = 403;
      } else if (error.message.includes("Invalid OpenAI API key") || error.message.includes("not set")) {
        statusCode = 401;
      } else if (error.message.includes("rate limit")) {
        statusCode = 429;
      }
    }
    
    return NextResponse.json(
      {
        error: errorMessage,
      },
      { status: statusCode }
    );
  }
}
