import "server-only";

import { MailAuthError, MailThrottledError } from "@/lib/integrations/providers";
import { MailCursorExpiredError, type FetchedMessage, type MailPage } from "@/lib/mail/types";

const GRAPH = "https://graph.microsoft.com/v1.0";
const PAGE_SIZE = 50;
const SELECT = "id,receivedDateTime,from,toRecipients,subject,bodyPreview,webLink,conversationId";

type GraphAddress = { emailAddress?: { name?: string; address?: string } };
type GraphMessage = {
  id: string;
  receivedDateTime?: string;
  from?: GraphAddress;
  toRecipients?: GraphAddress[];
  subject?: string;
  bodyPreview?: string;
  webLink?: string;
  conversationId?: string;
  "@removed"?: unknown;
};

/** Graph request with the errors the sync cares about turned into typed ones. */
export async function graph<T>(accessToken: string, url: string, init: RequestInit = {}): Promise<T | null> {
  const res = await fetch(url.startsWith("http") ? url : `${GRAPH}${url}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Prefer: `odata.maxpagesize=${PAGE_SIZE}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 204) return null;
  if (res.ok) return (await res.json()) as T;

  const body = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
  const code = body.error?.code ?? "";
  if (res.status === 429 || res.status === 503 || res.status === 504) {
    throw new MailThrottledError(`Microsoft asked to wait (${res.headers.get("Retry-After") ?? "?"} s).`);
  }
  if (res.status === 401 || code === "InvalidAuthenticationToken") {
    throw new MailAuthError("Microsoft asked to sign in again. Click Reconnect.");
  }
  // The delta position is too old or no longer known.
  if (res.status === 410 || /syncStateNotFound|resyncRequired|SyncStateInvalid/i.test(code)) {
    throw new MailCursorExpiredError(code || "Delta position expired.");
  }
  const error = new Error(`Microsoft Graph ${res.status} ${code}`.trim()) as Error & { status?: number };
  error.status = res.status;
  throw error;
}

function toMessage(m: GraphMessage, accountEmail: string): FetchedMessage | null {
  if (m["@removed"] || !m.receivedDateTime) return null;
  const recipients = (m.toRecipients ?? []).map((r) => r.emailAddress?.address?.toLowerCase()).filter(Boolean);
  return {
    providerId: m.id,
    threadId: m.conversationId ?? null,
    receivedAt: m.receivedDateTime,
    fromName: m.from?.emailAddress?.name?.trim() || null,
    fromEmail: m.from?.emailAddress?.address?.trim().toLowerCase() ?? "",
    // The candidate's address when they were among the recipients (aliases, forwarding).
    toEmail: (recipients.includes(accountEmail) ? accountEmail : recipients[0]) ?? null,
    subject: m.subject ?? "",
    preview: m.bodyPreview ?? "",
    webLink: m.webLink ?? null,
  };
}

/**
 * One page of the Inbox through Graph delta. Without a cursor it starts a scan from `since`; the
 * cursor is the next page's link while scanning, then the delta link that returns only new mail.
 */
export async function fetchMicrosoftMailPage(input: {
  accessToken: string;
  accountEmail: string;
  cursor: string | null;
  since: Date;
}): Promise<MailPage> {
  const start =
    `${GRAPH}/me/mailFolders/inbox/messages/delta?$select=${SELECT}` +
    `&$filter=receivedDateTime+ge+${input.since.toISOString().replace(/\.\d+Z$/, "Z")}`;
  const page = await graph<{ value: GraphMessage[]; "@odata.nextLink"?: string; "@odata.deltaLink"?: string }>(
    input.accessToken,
    input.cursor ?? start,
  );
  const next = page?.["@odata.nextLink"];
  const delta = page?.["@odata.deltaLink"];
  if (!next && !delta) throw new Error("Microsoft Graph returned no next or delta link.");
  return {
    messages: (page?.value ?? [])
      .map((m) => toMessage(m, input.accountEmail))
      .filter((m): m is FetchedMessage => m !== null),
    cursor: (next ?? delta)!,
    done: !next,
  };
}

// --- Change notifications ("live updates") ---------------------------------------------------

/** Messages allow at most 4230 minutes; renewed by the timer when less than a day is left. */
const SUBSCRIPTION_MINUTES = 4200;

function expiry(): string {
  return new Date(Date.now() + SUBSCRIPTION_MINUTES * 60_000).toISOString();
}

/** Graph checks the address before it answers, so the site must be deployed and public. */
export async function createMicrosoftSubscription(
  accessToken: string,
  notificationUrl: string,
  clientState: string,
): Promise<{ id: string; expiresAt: string }> {
  const created = await graph<{ id: string; expirationDateTime: string }>(accessToken, "/subscriptions", {
    method: "POST",
    body: JSON.stringify({
      changeType: "created",
      notificationUrl,
      lifecycleNotificationUrl: notificationUrl,
      resource: "me/mailFolders('Inbox')/messages",
      expirationDateTime: expiry(),
      clientState,
    }),
  });
  if (!created?.id) throw new Error("Microsoft did not create the subscription.");
  return { id: created.id, expiresAt: created.expirationDateTime };
}

/** New expiry, or null when Microsoft no longer knows the subscription (create a new one). */
export async function renewMicrosoftSubscription(accessToken: string, id: string): Promise<string | null> {
  try {
    const renewed = await graph<{ expirationDateTime: string }>(accessToken, `/subscriptions/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ expirationDateTime: expiry() }),
    });
    return renewed?.expirationDateTime ?? null;
  } catch (error) {
    if ((error as { status?: number }).status === 404) return null;
    throw error;
  }
}

export async function deleteMicrosoftSubscription(accessToken: string, id: string): Promise<void> {
  try {
    await graph(accessToken, `/subscriptions/${encodeURIComponent(id)}`, { method: "DELETE" });
  } catch (error) {
    if ((error as { status?: number }).status !== 404) throw error;
  }
}

// --- Folders other than the Inbox -------------------------------------------------------------

/** Not job mail, or the user's own: never read. */
const SKIPPED_FOLDERS = ["inbox", "sentitems", "drafts", "deleteditems", "outbox"];

type GraphFolder = { id: string; displayName?: string; childFolderCount?: number; totalItemCount?: number };

/**
 * Junk, Archive and the user's own folders (one level of sub-folders too), where Outlook rules
 * or archiving put mail the Inbox delta never sees.
 */
export async function listOtherMicrosoftFolders(accessToken: string): Promise<{ id: string; name: string }[]> {
  const skipped = new Set<string>();
  let inboxId: string | null = null;
  for (const name of SKIPPED_FOLDERS) {
    const f = await graph<GraphFolder>(accessToken, `/me/mailFolders/${name}?$select=id`).catch(() => null);
    if (!f?.id) continue;
    skipped.add(f.id);
    if (name === "inbox") inboxId = f.id;
  }
  const top = (await graph<{ value: GraphFolder[] }>(accessToken, "/me/mailFolders?$top=100&$select=id,displayName,childFolderCount"))?.value ?? [];
  const out: { id: string; name: string }[] = [];
  for (const f of top) {
    const own = !skipped.has(f.id);
    if (own) out.push({ id: f.id, name: f.displayName ?? "" });
    // Sub-folders of the user's folders and of the Inbox (where rules often file mail).
    if ((f.childFolderCount ?? 0) > 0 && (own || f.id === inboxId)) {
      const kids =
        (await graph<{ value: GraphFolder[] }>(accessToken, `/me/mailFolders/${f.id}/childFolders?$top=100&$select=id,displayName`))?.value ?? [];
      for (const k of kids) if (!skipped.has(k.id)) out.push({ id: k.id, name: `${f.displayName ?? ""}/${k.displayName ?? ""}` });
    }
  }
  return out;
}

/** A folder's messages received since `since`, newest first (at most 100). */
export async function fetchMicrosoftFolderMessages(
  accessToken: string,
  accountEmail: string,
  folderId: string,
  since: Date,
): Promise<FetchedMessage[]> {
  const out: FetchedMessage[] = [];
  let url: string | null =
    `/me/mailFolders/${encodeURIComponent(folderId)}/messages?$select=${SELECT}&$top=50&$orderby=receivedDateTime desc` +
    `&$filter=receivedDateTime ge ${since.toISOString().replace(/\.\d+Z$/, "Z")}`;
  for (let page = 0; url && page < 2; page++) {
    const body: { value: GraphMessage[]; "@odata.nextLink"?: string } | null = await graph(accessToken, url);
    for (const m of body?.value ?? []) {
      const message = toMessage(m, accountEmail);
      if (message) out.push(message);
    }
    url = body?.["@odata.nextLink"] ?? null;
  }
  return out;
}
