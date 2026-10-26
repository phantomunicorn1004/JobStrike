/** One message as a provider lists it: headers and a short preview only, never the body. */
export type FetchedMessage = {
  providerId: string;
  threadId: string | null;
  receivedAt: string;
  fromName: string | null;
  fromEmail: string;
  toEmail: string | null;
  subject: string;
  /** Provider preview (Graph bodyPreview, Gmail snippet), at most a few hundred characters. */
  preview: string;
  webLink: string | null;
};

/** One page of a sync; `cursor` is where the next page (or the next sync) continues. */
export type MailPage = {
  messages: FetchedMessage[];
  cursor: string;
  /** True when the provider has nothing more right now (the cursor then waits for new mail). */
  done: boolean;
};

/** The stored position is too old for the provider; the sync starts a new scan. */
export class MailCursorExpiredError extends Error {}

/** Shown in Settings while a mailbox is being read. */
export type MailSyncProgress = {
  phase?: "initial" | "ready";
  scanned?: number;
  kept?: number;
  startedAt?: string;
  finishedAt?: string;
  /** When the folders other than the Inbox were last read. */
  otherFoldersAt?: string;
};
