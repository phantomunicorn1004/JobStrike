import "server-only";

import { google } from "googleapis";
import { graph } from "@/lib/integrations/microsoft/mail";
import { accessTokenFor } from "@/lib/mail/sync";
import { listActiveSyncAccounts, type SyncAccount } from "@/lib/mail/sync-repository";

const GRAPH = "https://graph.microsoft.com/v1.0";

type GraphAddress = { emailAddress?: { name?: string; address?: string } };
type GraphMessage = {
  id: string;
  receivedDateTime?: string;
  from?: GraphAddress;
  subject?: string;
  bodyPreview?: string;
};

const GREENHOUSE_SENDER_RE = /greenhouse|no-?reply|noreply|verification|verify/i;
const CODE_SUBJECT_RE = /\b(verification code|security code|verify|one[- ]time code|confirm your|action required)/i;

/**
 * Greenhouse codes are 8 alphanumeric characters, always mixed (letters + digits).
 * A pure-letter 8-char string is likely a word, so we require at least one digit.
 */
function extractCode(text: string): string | null {
  const matches = text.match(/\b[A-Za-z0-9]{8}\b/g);
  if (!matches) return null;
  for (const m of matches) {
    if (/\d/.test(m) && /[A-Za-z]/.test(m)) return m;
  }
  for (const m of matches) {
    if (/\d/.test(m)) return m;
  }
  return null;
}

function isVerificationMessage(from: string, subject: string, text: string): boolean {
  return (
    GREENHOUSE_SENDER_RE.test(from) ||
    (CODE_SUBJECT_RE.test(subject) && /code/i.test(text))
  );
}

export type VerifyCodeResult = {
  code: string | null;
  receivedAt: string | null;
  subject: string | null;
};

const EMPTY: VerifyCodeResult = { code: null, receivedAt: null, subject: null };

async function fetchFromMicrosoft(
  account: SyncAccount,
  since: string,
): Promise<VerifyCodeResult> {
  const accessToken = await accessTokenFor(account);
  const url =
    `${GRAPH}/me/messages?$select=id,receivedDateTime,from,subject,bodyPreview` +
    `&$filter=receivedDateTime ge ${since}` +
    `&$orderby=receivedDateTime desc&$top=10`;

  const page = await graph<{ value: GraphMessage[] }>(accessToken, url);
  if (!page?.value?.length) return EMPTY;

  for (const msg of page.value) {
    const from = msg.from?.emailAddress?.address?.toLowerCase() ?? "";
    const subject = msg.subject ?? "";
    const preview = msg.bodyPreview ?? "";
    const text = `${subject} ${preview}`;

    if (!isVerificationMessage(from, subject, text)) continue;
    const code = extractCode(preview) || extractCode(subject);
    if (code) return { code, receivedAt: msg.receivedDateTime ?? null, subject };
  }
  return EMPTY;
}

async function fetchFromGmail(
  account: SyncAccount,
): Promise<VerifyCodeResult> {
  const accessToken = await accessTokenFor(account);
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  const gmail = google.gmail({ version: "v1", auth });

  const { data: listData } = await gmail.users.messages.list({
    userId: "me",
    q: "newer_than:15m (verification OR verify OR code OR security)",
    maxResults: 10,
  });
  if (!listData.messages?.length) return EMPTY;

  for (const item of listData.messages) {
    if (!item.id) continue;
    const { data: msg } = await gmail.users.messages.get({
      userId: "me",
      id: item.id,
      format: "metadata",
      metadataHeaders: ["From", "Subject"],
    });
    const header = (name: string) =>
      msg.payload?.headers?.find((h) => h.name?.toLowerCase() === name)?.value ?? "";
    const from = header("from").toLowerCase();
    const subject = header("subject");
    const snippet = msg.snippet ?? "";
    const text = `${subject} ${snippet}`;

    if (!isVerificationMessage(from, subject, text)) continue;
    const code = extractCode(snippet) || extractCode(subject);
    if (code) {
      return {
        code,
        receivedAt: new Date(Number(msg.internalDate ?? Date.now())).toISOString(),
        subject,
      };
    }
  }
  return EMPTY;
}

/**
 * Fetches the most recent verification code email for a profile from either
 * Microsoft Graph or Gmail, whichever mailbox is connected. Returns the 8-char
 * code if found, null otherwise.
 */
export async function fetchVerificationCode(
  userId: string,
  profileId: number,
): Promise<VerifyCodeResult> {
  const accounts = await listActiveSyncAccounts(userId);
  const account = accounts.find(
    (a) => a.profile_id === profileId && (a.provider === "microsoft" || a.provider === "google"),
  );
  if (!account) return EMPTY;

  const since = new Date(Date.now() - 10 * 60_000).toISOString().replace(/\.\d+Z$/, "Z");

  try {
    if (account.provider === "microsoft") {
      return await fetchFromMicrosoft(account, since);
    }
    return await fetchFromGmail(account);
  } catch {
    return EMPTY;
  }
}
