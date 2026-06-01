"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Copy, Loader2 } from "lucide-react";

type DriveStatus = {
  connected: boolean;
  googleEmail: string | null;
  folderId: string;
  defaultResumeUrl: string;
  defaultCoverUrl: string;
  oauthReady: boolean;
  oauthWebConfigured: boolean;
  hasOAuthClientId: boolean;
  oauthClientId: string;
  redirectUri: string;
  serviceAccountConfigured: boolean;
};

const OAUTH_POPUP = "google-drive-oauth";
const POPUP_FEATURES = "width=520,height=720,menubar=no,toolbar=no,location=yes,status=no";

export function GoogleDriveSettingsCard() {
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<DriveStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingOAuth, setSavingOAuth] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [folderId, setFolderId] = useState("");
  const [defaultResumeUrl, setDefaultResumeUrl] = useState("");
  const [defaultCoverUrl, setDefaultCoverUrl] = useState("");
  const [oauthClientId, setOauthClientId] = useState("");
  const [oauthClientSecret, setOauthClientSecret] = useState("");

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/integrations/google-drive/status", {
        credentials: "same-origin",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load status");
      setStatus(data);
      setFolderId(data.folderId || "");
      setDefaultResumeUrl(data.defaultResumeUrl || "");
      setDefaultCoverUrl(data.defaultCoverUrl || "");
      setOauthClientId(data.oauthClientId || "");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to load Google Drive status",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    const google = searchParams.get("google");
    if (google === "connected") {
      toast.success("Google Drive connected.");
      void loadStatus();
    } else if (google === "error") {
      const reason = searchParams.get("reason") || "unknown";
      toast.error(`Google Drive connection failed: ${reason}`);
    }
  }, [searchParams, loadStatus]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data as { type?: string; ok?: boolean; reason?: string | null };
      if (data?.type !== OAUTH_POPUP) return;

      setConnecting(false);
      if (data.ok) {
        toast.success("Google Drive connected.");
        void loadStatus();
      } else {
        toast.error(
          `Google Drive connection failed: ${data.reason || "unknown"}`,
        );
      }
    };

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [loadStatus]);

  const saveOAuthCredentials = async () => {
    setSavingOAuth(true);
    try {
      const res = await fetch("/api/integrations/google-drive/status", {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          oauthClientId,
          oauthClientSecret,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      toast.success("OAuth settings saved.");
      setOauthClientSecret("");
      await loadStatus();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Save failed");
    } finally {
      setSavingOAuth(false);
    }
  };

  const connectGoogleDrive = async () => {
    setConnecting(true);
    try {
      if (oauthClientId.trim() || oauthClientSecret.trim()) {
        const res = await fetch("/api/integrations/google-drive/status", {
          method: "PATCH",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            oauthClientId,
            oauthClientSecret,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to save OAuth settings");
        setOauthClientSecret("");
        setStatus((prev) =>
          prev
            ? {
                ...prev,
                oauthClientId: data.oauthClientId || oauthClientId,
                oauthReady: data.oauthReady,
                hasOAuthClientId: data.hasOAuthClientId,
                redirectUri: data.redirectUri || prev.redirectUri,
              }
            : prev,
        );
        if (!data.oauthReady) {
          throw new Error(
            "Enter OAuth Client ID and Client Secret, then try again.",
          );
        }
      } else if (!status?.oauthReady) {
        throw new Error(
          "Enter OAuth Client ID and Client Secret from Google Cloud Console.",
        );
      }

      const popup = window.open(
        "/api/integrations/google-drive/connect?popup=1",
        "google-drive-oauth",
        POPUP_FEATURES,
      );
      if (!popup) {
        window.location.href = "/api/integrations/google-drive/connect";
        return;
      }
    } catch (error) {
      setConnecting(false);
      toast.error(error instanceof Error ? error.message : "Connect failed");
    }
  };

  const copyRedirectUri = async () => {
    const uri = status?.redirectUri;
    if (!uri) return;
    try {
      await navigator.clipboard.writeText(uri);
      toast.success("Redirect URI copied.");
    } catch {
      toast.error("Could not copy redirect URI.");
    }
  };

  const savePreferences = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/integrations/google-drive/status", {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          folderId,
          defaultResumeUrl,
          defaultCoverUrl,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      toast.success("Preferences saved.");
      await loadStatus();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const disconnect = async () => {
    setDisconnecting(true);
    try {
      const res = await fetch("/api/integrations/google-drive/disconnect", {
        method: "POST",
        credentials: "same-origin",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Disconnect failed");
      toast.success("Google Drive disconnected.");
      await loadStatus();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Disconnect failed");
    } finally {
      setDisconnecting(false);
    }
  };

  const canConnect = status?.oauthReady || Boolean(oauthClientId.trim() && oauthClientSecret.trim());

  return (
    <Card>
      <CardHeader>
        <CardTitle>Google Drive</CardTitle>
        <CardDescription>
          Connect your personal Gmail once. The Chrome extension uploads resume and cover
          letter files through this website—no Google sign-in needed in the extension.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading…
          </div>
        ) : (
          <>
            <div className="rounded-lg border bg-muted/40 px-3 py-2 text-sm">
              {status?.connected ? (
                <p>
                  <span className="text-muted-foreground">Connected to Google Drive as </span>
                  <strong>{status.googleEmail || "Google account"}</strong>
                </p>
              ) : (
                <p className="text-muted-foreground">Not connected to Google Drive</p>
              )}
              {status?.serviceAccountConfigured ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  Service account fallback is enabled if you are not connected.
                </p>
              ) : null}
            </div>

            <div className="space-y-3 rounded-lg border p-3">
              <p className="text-sm font-medium">Google OAuth app</p>
              {status?.oauthWebConfigured ? (
                <p className="text-xs text-muted-foreground">
                  Server OAuth is already configured. You can connect Google Drive directly,
                  or use your own OAuth client below.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Create a Web application OAuth client in{" "}
                  <a
                    href="https://console.cloud.google.com/apis/credentials"
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
                  >
                    Google Cloud Console
                  </a>
                  . Add the redirect URI below, then paste your Client ID and Secret.
                </p>
              )}
              <div className="space-y-2">
                <Label htmlFor="oauthRedirectUri">Redirect URI</Label>
                <div className="flex gap-2">
                  <Input
                    id="oauthRedirectUri"
                    readOnly
                    value={status?.redirectUri || ""}
                    className="font-mono text-xs"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => void copyRedirectUri()}
                    aria-label="Copy redirect URI"
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="oauthClientId">OAuth Client ID</Label>
                <Input
                  id="oauthClientId"
                  value={oauthClientId}
                  onChange={(e) => setOauthClientId(e.target.value)}
                  placeholder="123456789.apps.googleusercontent.com"
                  autoComplete="off"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="oauthClientSecret">OAuth Client Secret</Label>
                <Input
                  id="oauthClientSecret"
                  type="password"
                  value={oauthClientSecret}
                  onChange={(e) => setOauthClientSecret(e.target.value)}
                  placeholder={
                    status?.oauthReady && !oauthClientSecret
                      ? "Saved (enter only to replace)"
                      : "From Google Cloud Console"
                  }
                  autoComplete="new-password"
                />
              </div>
              <Button
                type="button"
                variant="secondary"
                disabled={savingOAuth}
                onClick={() => void saveOAuthCredentials()}
              >
                {savingOAuth ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Saving…
                  </>
                ) : (
                  "Save OAuth settings"
                )}
              </Button>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                disabled={!canConnect || connecting || status?.connected}
                onClick={() => void connectGoogleDrive()}
              >
                {connecting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Connecting…
                  </>
                ) : (
                  "Connect to Google Drive"
                )}
              </Button>
              {status?.connected ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={disconnecting}
                  onClick={() => void disconnect()}
                >
                  {disconnecting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Disconnecting…
                    </>
                  ) : (
                    "Disconnect"
                  )}
                </Button>
              ) : null}
            </div>

            <div className="space-y-3 border-t pt-4">
              <div className="space-y-2">
                <Label htmlFor="driveFolderId">Upload folder ID (optional)</Label>
                <Input
                  id="driveFolderId"
                  value={folderId}
                  onChange={(e) => setFolderId(e.target.value)}
                  placeholder="From drive.google.com/.../folders/…"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="defaultResumeUrl">Default resume sharing link</Label>
                <Input
                  id="defaultResumeUrl"
                  type="url"
                  value={defaultResumeUrl}
                  onChange={(e) => setDefaultResumeUrl(e.target.value)}
                  placeholder="https://drive.google.com/file/d/…/view"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="defaultCoverUrl">Default cover letter sharing link</Label>
                <Input
                  id="defaultCoverUrl"
                  type="url"
                  value={defaultCoverUrl}
                  onChange={(e) => setDefaultCoverUrl(e.target.value)}
                  placeholder="https://drive.google.com/file/d/…/view"
                />
              </div>
              <Button type="button" onClick={() => void savePreferences()} disabled={saving}>
                {saving ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Saving…
                  </>
                ) : (
                  "Save preferences"
                )}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
