import "server-only";

import { graph } from "@/lib/integrations/microsoft/mail";
import { accessTokenFor } from "@/lib/mail/sync";
import { listActiveSyncAccounts } from "@/lib/mail/sync-repository";

const GRAPH = "https://graph.microsoft.com/v1.0";

type GraphAddress = { emailAddress?: { name?: string; address?: string } };
type GraphMessage = {
  id: string;
  receivedDateTime?: string;
  from?: GraphAddress;
  subject?: string;
  bodyPreview?: string;
};

const GREENHOUSE_SENDER_RE = /greenhouse/i;
const CODE_SUBJECT_RE = /\b(verification code|security code|verify|one[- ]time code|confirm your)/i;

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

export type VerifyCodeResult = {
  code: string | null;
  receivedAt: string | null;
  subject: string | null;
};

/**
 * Fetches the most recent Greenhouse verification code email for a profile,
 * directly from the Graph API (not from stored messages). Returns the 8-char
 * code if found, null otherwise.
 */
export async function fetchVerificationCode(
  userId: string,
  profileId: number,
): Promise<VerifyCodeResult> {
  const accounts = await listActiveSyncAccounts(userId);
  const account = accounts.find((a) => a.profile_id === profileId && a.provider === "microsoft");
  if (!account) return { code: null, receivedAt: null, subject: null };

  const accessToken = await accessTokenFor(account);
  const since = new Date(Date.now() - 10 * 60_000).toISOString().replace(/\.\d+Z$/, "Z");

  const url =
    `${GRAPH}/me/messages?$select=id,receivedDateTime,from,subject,bodyPreview` +
    `&$filter=receivedDateTime ge ${since}` +
    `&$orderby=receivedDateTime desc&$top=10`;

  const page = await graph<{ value: GraphMessage[] }>(accessToken, url);
  if (!page?.value?.length) return { code: null, receivedAt: null, subject: null };

  for (const msg of page.value) {
    const from = msg.from?.emailAddress?.address?.toLowerCase() ?? "";
    const subject = msg.subject ?? "";
    const preview = msg.bodyPreview ?? "";
    const text = `${subject} ${preview}`;

    const isVerification =
      GREENHOUSE_SENDER_RE.test(from) ||
      (CODE_SUBJECT_RE.test(subject) && /code/i.test(text));

    if (!isVerification) continue;

    const code = extractCode(preview) || extractCode(subject);
    if (code) {
      return { code, receivedAt: msg.receivedDateTime ?? null, subject };
    }
  }

  return { code: null, receivedAt: null, subject: null };
}
