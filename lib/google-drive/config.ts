export function isGoogleDriveConfigured(): boolean {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim();
  const key = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.trim();
  return Boolean(email && key);
}

export function getGoogleDriveFolderId(): string | undefined {
  const id = process.env.GOOGLE_DRIVE_FOLDER_ID?.trim();
  return id || undefined;
}

export function getServiceAccountCredentials(): {
  client_email: string;
  private_key: string;
} {
  const client_email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim();
  const rawKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.trim();
  if (!client_email || !rawKey) {
    throw new Error(
      "Google Drive is not configured. Set GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY on the server.",
    );
  }
  const private_key = rawKey.includes("\\n")
    ? rawKey.replace(/\\n/g, "\n")
    : rawKey;
  return { client_email, private_key };
}
