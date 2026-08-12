import { NextResponse } from "next/server";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, X-Extension-Key, Authorization",
};

export function corsJson(
  data: unknown,
  init?: { status?: number },
): NextResponse {
  return NextResponse.json(data, {
    status: init?.status ?? 200,
    headers: CORS_HEADERS,
  });
}

export function corsOptions(): NextResponse {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export function verifyExtensionKey(request: Request): string | null {
  const expected = process.env.EXTENSION_API_KEY?.trim();
  if (!expected) return null;
  const provided = request.headers.get("x-extension-key")?.trim();
  if (provided !== expected) {
    return "Unauthorized: invalid or missing X-Extension-Key.";
  }
  return null;
}
