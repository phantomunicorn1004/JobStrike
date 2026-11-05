"use client";

import { useEffect } from "react";

const STORAGE_KEY = "jobstrike.mailAutoSyncAt";
const EVERY_MS = 5 * 60_000;

/**
 * Sync on open: when a member page opens, the server reads connected mailboxes that were not
 * synced for a few minutes (in the background; the page does not wait). At most every 5 minutes.
 */
export function MailAutoSync() {
  useEffect(() => {
    try {
      const last = Number(window.localStorage.getItem(STORAGE_KEY) || 0);
      if (Date.now() - last < EVERY_MS) return;
    } catch {
      // No storage (private window): still fine to ask; the server skips fresh mailboxes.
    }
    // Start after the page has loaded so the sync never competes with what the user opened.
    const timer = window.setTimeout(() => {
      try {
        window.localStorage.setItem(STORAGE_KEY, String(Date.now()));
      } catch {}
      void fetch("/api/integrations/mail/sync", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auto: true }),
      }).catch(() => {});
    }, 8_000);
    return () => window.clearTimeout(timer);
  }, []);

  return null;
}
