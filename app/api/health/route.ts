import { corsJson, corsOptions } from "@/lib/api/extensionCors";

export function OPTIONS() {
  return corsOptions();
}

export async function GET() {
  return corsJson({
    ok: true,
    service: "remote-work-helper",
    timestamp: new Date().toISOString(),
  });
}
