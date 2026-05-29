import { corsJson, corsOptions } from "@/lib/api/extensionCors";
import { isGoogleDriveConfigured } from "@/lib/google-drive/config";

export function OPTIONS() {
  return corsOptions();
}

export async function GET() {
  return corsJson({
    ok: true,
    service: "remote-work-helper",
    timestamp: new Date().toISOString(),
    googleDrive: {
      configured: isGoogleDriveConfigured(),
    },
  });
}
