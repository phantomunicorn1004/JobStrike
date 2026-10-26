import "server-only";

import { google, type gmail_v1 } from "googleapis";
import { MailAuthError, MailThrottledError } from "@/lib/integrations/providers";
import { MailCursorExpiredError, type FetchedMessage, type MailPage } from "@/lib/mail/types";

const PAGE_SIZE = 50;
const PARALLEL = 10;
/** Everything the user received, without their own, chat, spam and bin messages. */
/** Everything received, in every label and in Spam (rejections land there too). */
const RECEIVED = "-in:sent -in:drafts -in:chats -in:trash in:anywhere";
const SKIP_LABELS = new Set(["SENT", "DRAFT", "CHAT", "TRASH"]);

/**
 * Stored position. While scanning: the history id from the start (`h`), the time the scan reaches
 * back to (`a`, seconds) and the next page (`p`). Afterwards `h` alone: history since then.
 */
type GmailCursor = { h: string; a?: number; p?: string; mode: "scan" | "history" };

function gmailClient(accessToken: string) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return google.gmail({ version: "v1", auth });
}

function rethrow(error: unknown): never {
  const status = (error as { code?: number; status?: number }).code ?? (error as { status?: number }).status;
  const message = error instanceof Error ? error.message : String(error);
  if (status === 401) throw new MailAuthError("Google asked to sign in again. Click Reconnect.");
  if (status === 429 || (status === 403 && /rate ?limit/i.test(message))) {
    throw new MailThrottledError("Google asked to wait.");
  }
  // The start history id is too old (kept for about a week).
  if (status === 404) throw new MailCursorExpiredError("Gmail history expired.");
  throw error;
}

function parseAddress(value: string | undefined): { name: string | null; email: string } {
  const text = (value ?? "").trim();
  const angle = text.match(/^(.*)<([^>]+)>\s*$/);
  if (angle) return { name: angle[1].replace(/^"|"$/g, "").trim() || null, email: angle[2].trim().toLowerCase() };
  return { name: null, email: text.toLowerCase() };
}

async function readMessage(
  gmail: gmail_v1.Gmail,
  id: string,
  accountEmail: string,
): Promise<FetchedMessage | null> {
  const { data } = await gmail.users.messages.get({
    userId: "me",
    id,
    format: "metadata",
    metadataHeaders: ["From", "To", "Subject"],
  });
  if (!data.id || (data.labelIds ?? []).some((label) => SKIP_LABELS.has(label))) return null;
  const header = (name: string) => data.payload?.headers?.find((h) => h.name?.toLowerCase() === name)?.value ?? "";
  const from = parseAddress(header("from"));
  const to = header("to")
    .split(",")
    .map((part) => parseAddress(part).email)
    .filter(Boolean);
  return {
    providerId: data.id,
    threadId: data.threadId ?? null,
    receivedAt: new Date(Number(data.internalDate ?? Date.now())).toISOString(),
    fromName: from.name,
    fromEmail: from.email,
    toEmail: (to.includes(accountEmail) ? accountEmail : to[0]) ?? null,
    subject: header("subject"),
    preview: data.snippet ?? "",
    webLink: `https://mail.google.com/mail/?authuser=${encodeURIComponent(accountEmail)}#all/${data.id}`,
  };
}

/** Gmail allows about 250 quota units per second; a metadata read costs 5, so 10 at a time. */
async function readMessages(gmail: gmail_v1.Gmail, ids: string[], accountEmail: string): Promise<FetchedMessage[]> {
  const out: FetchedMessage[] = [];
  for (let i = 0; i < ids.length; i += PARALLEL) {
    const batch = await Promise.all(
      ids.slice(i, i + PARALLEL).map((id) =>
        readMessage(gmail, id, accountEmail).catch((error) => {
          // Deleted between listing and reading.
          if ((error as { code?: number }).code === 404) return null;
          throw error;
        }),
      ),
    );
    out.push(...batch.filter((m): m is FetchedMessage => m !== null));
  }
  return out;
}

export async function fetchGmailPage(input: {
  accessToken: string;
  accountEmail: string;
  cursor: string | null;
  since: Date;
}): Promise<MailPage> {
  const gmail = gmailClient(input.accessToken);
  try {
    let cursor: GmailCursor;
    if (input.cursor) {
      cursor = JSON.parse(input.cursor) as GmailCursor;
    } else {
      // History from this moment on covers anything that arrives during the scan.
      const { data } = await gmail.users.getProfile({ userId: "me" });
      cursor = { h: String(data.historyId), a: Math.floor(input.since.getTime() / 1000), mode: "scan" };
    }

    if (cursor.mode === "scan") {
      const { data } = await gmail.users.messages.list({
        userId: "me",
        q: `after:${cursor.a} ${RECEIVED}`,
        maxResults: PAGE_SIZE,
        pageToken: cursor.p,
      });
      const messages = await readMessages(gmail, (data.messages ?? []).map((m) => m.id!).filter(Boolean), input.accountEmail);
      const next: GmailCursor = data.nextPageToken
        ? { ...cursor, p: data.nextPageToken }
        : { h: cursor.h, mode: "history" };
      return { messages, cursor: JSON.stringify(next), done: !data.nextPageToken };
    }

    const { data } = await gmail.users.history.list({
      userId: "me",
      startHistoryId: cursor.h,
      historyTypes: ["messageAdded"],
      maxResults: 100,
      pageToken: cursor.p,
    });
    const ids = new Set<string>();
    for (const entry of data.history ?? []) {
      for (const added of entry.messagesAdded ?? []) {
        const message = added.message;
        if (message?.id && !(message.labelIds ?? []).some((label) => SKIP_LABELS.has(label))) ids.add(message.id);
      }
    }
    const messages = await readMessages(gmail, [...ids], input.accountEmail);
    const next: GmailCursor = data.nextPageToken
      ? { h: cursor.h, p: data.nextPageToken, mode: "history" }
      : { h: String(data.historyId ?? cursor.h), mode: "history" };
    return { messages, cursor: JSON.stringify(next), done: !data.nextPageToken };
  } catch (error) {
    rethrow(error);
  }
}
