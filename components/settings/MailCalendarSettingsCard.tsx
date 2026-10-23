"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { AlertTriangle, CalendarDays, Loader2, Mail, RefreshCw, ShieldCheck, Unplug } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  MAIL_OAUTH_MESSAGE,
  MAIL_PROVIDER_LABELS,
  MAIL_PROVIDERS,
  type MailAccountView,
  type MailAccountsResponse,
  type MailAutomation,
  type MailOAuthResult,
  type MailProvider,
} from "@/lib/integrations/types";

const POPUP_NAME = "mail-oauth";
const POPUP_FEATURES = "width=520,height=720,menubar=no,toolbar=no,location=yes,status=no";
const NO_PROFILE = "none";

const AUTOMATION_OPTIONS: { value: MailAutomation; label: string; hint: string }[] = [
  { value: "auto", label: "Automatic", hint: "Applies clear updates, asks about the rest" },
  { value: "suggest", label: "Suggest only", hint: "You approve every change" },
  { value: "off", label: "Off", hint: "Lists job emails, changes nothing" },
];

const PROVIDER_STYLE: Record<MailProvider, string> = {
  google: "bg-red-500/10 text-red-600 dark:text-red-400",
  microsoft: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
};

function lastSyncText(account: MailAccountView): string {
  if (!account.lastSyncAt) return "Not synced yet";
  const minutes = Math.round((Date.now() - new Date(account.lastSyncAt).getTime()) / 60000);
  if (minutes < 1) return "Synced just now";
  if (minutes < 60) return `Synced ${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Synced ${hours} h ago`;
  return `Synced ${new Date(account.lastSyncAt).toLocaleDateString()}`;
}

function StatusBadge({ account }: { account: MailAccountView }) {
  if (account.status === "reauth_required") {
    return (
      <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400">
        Reconnect needed
      </Badge>
    );
  }
  if (account.status === "disabled") return <Badge variant="secondary">Paused</Badge>;
  return (
    <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
      Connected
    </Badge>
  );
}

export function MailCalendarSettingsCard() {
  const searchParams = useSearchParams();
  const [data, setData] = useState<MailAccountsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileId, setProfileId] = useState<string>("");
  const [connecting, setConnecting] = useState<MailProvider | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState<MailAccountView | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const popupWatch = useRef<number | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/integrations/mail/accounts", { credentials: "same-origin" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Could not load connected mailboxes.");
      const next = body as MailAccountsResponse;
      setData(next);
      // Default to the first candidate who has no mailbox yet.
      setProfileId((current) => {
        if (current && next.profiles.some((p) => String(p.id) === current)) return current;
        const linked = new Set(next.accounts.map((a) => a.profileId));
        return String((next.profiles.find((p) => !linked.has(p.id)) ?? next.profiles[0])?.id ?? "");
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load connected mailboxes.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const stopPopupWatch = useCallback(() => {
    if (popupWatch.current !== null) window.clearInterval(popupWatch.current);
    popupWatch.current = null;
  }, []);

  const onResult = useCallback(
    (result: Pick<MailOAuthResult, "ok" | "message" | "email">) => {
      stopPopupWatch();
      setConnecting(null);
      if (result.ok) {
        toast.success(result.email ? `${result.email} connected.` : "Mailbox connected.");
        void load();
      } else {
        toast.error(result.message || "The mailbox was not connected.");
      }
    },
    [load, stopPopupWatch],
  );

  // Result from the popup.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const message = event.data as MailOAuthResult | undefined;
      if (message?.type === MAIL_OAUTH_MESSAGE) onResult(message);
    };
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
      stopPopupWatch();
    };
  }, [onResult, stopPopupWatch]);

  // Result after a full-page sign-in (popup blocked).
  useEffect(() => {
    const mail = searchParams.get("mail");
    if (mail === "connected" || mail === "error") {
      onResult({ ok: mail === "connected", message: searchParams.get("reason"), email: null });
    }
  }, [searchParams, onResult]);

  const connect = (provider: MailProvider, forProfileId: number | null) => {
    const params = new URLSearchParams({ popup: "1" });
    if (forProfileId !== null) params.set("profileId", String(forProfileId));
    const url = `/api/integrations/mail/${provider}/connect?${params}`;

    setConnecting(provider);
    const popup = window.open(url, POPUP_NAME, POPUP_FEATURES);
    if (!popup) {
      window.location.href = url;
      return;
    }
    // Closing the popup without finishing ends the "Connecting…" state.
    stopPopupWatch();
    popupWatch.current = window.setInterval(() => {
      if (popup.closed) {
        stopPopupWatch();
        setConnecting(null);
      }
    }, 600);
  };

  const save = async (account: MailAccountView, changes: { profileId?: number | null; automation?: MailAutomation }) => {
    setSavingId(account.id);
    try {
      const res = await fetch(`/api/integrations/mail/accounts/${account.id}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(changes),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Could not save.");
      const updated = body.account as MailAccountView;
      setData((prev) =>
        prev ? { ...prev, accounts: prev.accounts.map((a) => (a.id === updated.id ? updated : a)) } : prev,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save.");
    } finally {
      setSavingId(null);
    }
  };

  const disconnect = async (account: MailAccountView) => {
    setDisconnecting(true);
    try {
      const res = await fetch(`/api/integrations/mail/accounts/${account.id}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Could not disconnect.");
      toast.success(`${account.email} disconnected.`);
      setData((prev) => (prev ? { ...prev, accounts: prev.accounts.filter((a) => a.id !== account.id) } : prev));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not disconnect.");
    } finally {
      setDisconnecting(false);
      setConfirmDisconnect(null);
    }
  };

  const profileName = (id: number | null) => data?.profiles.find((p) => p.id === id)?.fullName;
  const blocked = !data || data.setupRequired || !data.encryptionReady;
  const anyProvider = data ? MAIL_PROVIDERS.some((p) => data.providers[p]) : false;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mail className="h-5 w-5 text-muted-foreground" />
          Email &amp; Calendar
        </CardTitle>
        <CardDescription>
          Connect each candidate&apos;s mailbox. JobStrike finds recruiter emails and interview invites, links them
          to applications, and keeps the pipeline and interview times up to date.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading…
          </div>
        ) : !data ? (
          <Button variant="outline" size="sm" onClick={() => void load()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Try again
          </Button>
        ) : (
          <>
            {data.setupRequired ? (
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Database setup needed</AlertTitle>
                <AlertDescription>
                  Run <code className="text-xs">scripts/add-mail-calendar-integration.sql</code> in the Supabase SQL
                  editor, then reload this page.
                </AlertDescription>
              </Alert>
            ) : null}
            {!data.encryptionReady ? (
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Server key missing</AlertTitle>
                <AlertDescription>
                  Set <code className="text-xs">TOKEN_ENCRYPTION_KEY</code> on the server; mailbox sign-ins are only
                  stored encrypted.
                </AlertDescription>
              </Alert>
            ) : null}

            {data.accounts.length > 0 ? (
              <ul className="space-y-3">
                {data.accounts.map((account) => (
                  <li key={account.id} className="rounded-lg border p-3">
                    <div className="flex flex-wrap items-start gap-3">
                      <div
                        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${PROVIDER_STYLE[account.provider]}`}
                        aria-hidden
                      >
                        <Mail className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate font-medium">{account.email}</span>
                          <StatusBadge account={account} />
                        </div>
                        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                          <span>{MAIL_PROVIDER_LABELS[account.provider]}</span>
                          <span aria-hidden>·</span>
                          <span>{lastSyncText(account)}</span>
                          <span aria-hidden>·</span>
                          <span className="inline-flex items-center gap-1">
                            <CalendarDays className="h-3 w-3" />
                            {account.canUseCalendar ? "Calendar on" : "No calendar access"}
                          </span>
                        </p>
                        {account.lastError ? (
                          <p className="mt-1 text-xs text-destructive">{account.lastError}</p>
                        ) : null}
                      </div>
                      <div className="flex gap-2">
                        {account.status === "reauth_required" ? (
                          <Button
                            size="sm"
                            disabled={connecting !== null}
                            onClick={() => connect(account.provider, account.profileId)}
                          >
                            Reconnect
                          </Button>
                        ) : null}
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-muted-foreground"
                          onClick={() => setConfirmDisconnect(account)}
                        >
                          <Unplug className="mr-1.5 h-4 w-4" />
                          Disconnect
                        </Button>
                      </div>
                    </div>

                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground">Candidate</Label>
                        <Select
                          value={account.profileId === null ? NO_PROFILE : String(account.profileId)}
                          disabled={savingId === account.id}
                          onValueChange={(v) => void save(account, { profileId: v === NO_PROFILE ? null : Number(v) })}
                        >
                          <SelectTrigger className="h-9 w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NO_PROFILE}>Not linked</SelectItem>
                            {data.profiles.map((p) => (
                              <SelectItem key={p.id} value={String(p.id)}>
                                {p.fullName}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground">Pipeline updates</Label>
                        <Select
                          value={account.automation}
                          disabled={savingId === account.id}
                          onValueChange={(v) => void save(account, { automation: v as MailAutomation })}
                        >
                          <SelectTrigger className="h-9 w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {AUTOMATION_OPTIONS.map((o) => (
                              <SelectItem key={o.value} value={o.value}>
                                {o.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground">
                          {AUTOMATION_OPTIONS.find((o) => o.value === account.automation)?.hint}
                        </p>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : !blocked ? (
              <p className="rounded-lg border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
                No mailbox connected yet.
              </p>
            ) : null}

            {data.profiles.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Add a candidate on the{" "}
                <Link href="/profile" className="underline">
                  Profile
                </Link>{" "}
                page first; each mailbox belongs to a candidate.
              </p>
            ) : (
              <div className="space-y-3 rounded-lg bg-muted/40 p-3">
                <div className="space-y-1.5">
                  <Label htmlFor="mailProfile" className="text-sm">
                    Connect a mailbox for
                  </Label>
                  <Select value={profileId} onValueChange={setProfileId} disabled={blocked}>
                    <SelectTrigger id="mailProfile" className="h-9 w-full bg-background sm:w-72">
                      <SelectValue placeholder="Choose a candidate" />
                    </SelectTrigger>
                    <SelectContent>
                      {data.profiles.map((p) => (
                        <SelectItem key={p.id} value={String(p.id)}>
                          {p.fullName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-wrap gap-2">
                  {MAIL_PROVIDERS.map((provider) => (
                    <Button
                      key={provider}
                      variant="outline"
                      className="bg-background"
                      disabled={blocked || !profileId || !data.providers[provider] || connecting !== null}
                      onClick={() => connect(provider, Number(profileId))}
                    >
                      {connecting === provider ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <span
                          className={`mr-2 flex h-5 w-5 items-center justify-center rounded ${PROVIDER_STYLE[provider]}`}
                          aria-hidden
                        >
                          <Mail className="h-3 w-3" />
                        </span>
                      )}
                      {connecting === provider ? "Waiting for sign-in…" : `Connect ${MAIL_PROVIDER_LABELS[provider]}`}
                    </Button>
                  ))}
                </div>
                {!anyProvider ? (
                  <p className="text-xs text-muted-foreground">
                    Google and Microsoft sign-in are not set up on this server yet.
                  </p>
                ) : (
                  MAIL_PROVIDERS.filter((p) => !data.providers[p]).map((p) => (
                    <p key={p} className="text-xs text-muted-foreground">
                      {MAIL_PROVIDER_LABELS[p]} sign-in is not set up on this server yet.
                    </p>
                  ))
                )}
              </div>
            )}

            <div className="flex gap-2 text-xs text-muted-foreground">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                JobStrike reads mail only to find job-related messages, and keeps just their sender, subject, date and
                a short excerpt, never whole emails. Calendar access is used to read interview events and to add
                interviews you choose. Sign-ins are stored encrypted, and Disconnect deletes everything kept from that
                mailbox. While the Google app is in testing, Gmail asks you to reconnect once a week.
              </p>
            </div>
          </>
        )}
      </CardContent>

      <AlertDialog open={confirmDisconnect !== null} onOpenChange={(open) => !open && setConfirmDisconnect(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect {confirmDisconnect?.email}?</AlertDialogTitle>
            <AlertDialogDescription>
              JobStrike stops reading this mailbox and calendar
              {profileName(confirmDisconnect?.profileId ?? null)
                ? ` for ${profileName(confirmDisconnect?.profileId ?? null)}`
                : ""}{" "}
              and deletes the emails it kept from it. Pipeline cards and interviews stay as they are.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={disconnecting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={disconnecting}
              onClick={(event) => {
                event.preventDefault();
                if (confirmDisconnect) void disconnect(confirmDisconnect);
              }}
            >
              {disconnecting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
