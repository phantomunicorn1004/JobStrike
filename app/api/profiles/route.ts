import { corsJson, corsOptions } from "@/lib/api/extensionCors";
import { listProfiles } from "@/lib/resume-db/repository";

export function OPTIONS() {
  return corsOptions();
}

export async function GET() {
  try {
    const profiles = await listProfiles();
    return corsJson({ profiles });
  } catch (error) {
    console.error("Profiles list error:", error);
    const message = error instanceof Error ? error.message : "Failed to load profiles.";
    return corsJson({ error: message }, { status: 500 });
  }
}
