import { google } from "googleapis";
import { getServiceAccountCredentials } from "@/lib/google-drive/config";

let driveClient: ReturnType<typeof google.drive> | null = null;

export function getDriveClient() {
  if (!driveClient) {
    const credentials = getServiceAccountCredentials();
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/drive.file"],
    });
    driveClient = google.drive({ version: "v3", auth });
  }
  return driveClient;
}
