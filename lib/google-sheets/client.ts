import { google } from "googleapis";

function getServiceAccountCredentials(): {
  client_email: string;
  private_key: string;
} {
  const jsonRaw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  if (jsonRaw) {
    const parsed = JSON.parse(jsonRaw) as {
      client_email?: string;
      private_key?: string;
    };
    if (!parsed.client_email || !parsed.private_key) {
      throw new Error(
        "GOOGLE_SERVICE_ACCOUNT_JSON must include client_email and private_key.",
      );
    }
    return {
      client_email: parsed.client_email,
      private_key: parsed.private_key,
    };
  }

  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim();
  const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(
    /\\n/g,
    "\n",
  )?.trim();

  if (!email || !privateKey) {
    throw new Error(
      "Google credentials missing. Set GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY.",
    );
  }

  return { client_email: email, private_key: privateKey };
}

export function getGoogleAuth(scopes: string[]) {
  const credentials = getServiceAccountCredentials();
  return new google.auth.GoogleAuth({
    credentials,
    scopes,
  });
}

export function getSheetId(): string {
  const id = process.env.GOOGLE_SHEET_ID?.trim();
  if (!id) {
    throw new Error("GOOGLE_SHEET_ID environment variable is not set.");
  }
  return id;
}

export function getSheetTabName(): string {
  return process.env.GOOGLE_SHEET_TAB?.trim() || "Table4";
}
