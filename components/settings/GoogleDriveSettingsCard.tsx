"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

type DriveStatus = {
  connected: boolean;
  googleEmail: string | null;
  folderId: string;
  defaultResumeUrl: string;
  defaultCoverUrl: string;
  oauthWebConfigured: boolean;
  serviceAccountConfigured: boolean;
};

export function GoogleDriveSettingsCard() {
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<DriveStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [folderId, setFolderId] = useState("");
  const [defaultResumeUrl, setDefaultResumeUrl] = useState("");
  const [defaultCoverUrl, setDefaultCoverUrl] = useState("");

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
                  <span className="text-muted-foreground">Connected as </span>
                  <strong>{status.googleEmail || "Google account"}</strong>
                </p>
              ) : status?.oauthWebConfigured ? (
                <p className="text-muted-foreground">Not connected</p>
              ) : (
                <p className="text-amber-700 dark:text-amber-300">
                  Server OAuth is not configured. Set{" "}
                  <code className="text-xs">GOOGLE_OAUTH_CLIENT_ID</code> and{" "}
                  <code className="text-xs">GOOGLE_OAUTH_CLIENT_SECRET</code> on the server.
                </p>
              )}
              {status?.serviceAccountConfigured ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  Service account fallback is enabled if you are not connected.
                </p>
              ) : null}
            </div>

            <div className="flex flex-wrap gap-2">
              {status?.oauthWebConfigured ? (
                <Button asChild variant="default" disabled={status.connected}>
                  <a href="/api/integrations/google-drive/connect">Connect Google Drive</a>
                </Button>
              ) : null}
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
