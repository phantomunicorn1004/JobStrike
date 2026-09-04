"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  DEFAULT_JSON2DOCX_SETTINGS,
  fetchJson2docxHealth,
  JSON2DOCX_OUTPUT_MODES,
  type Json2docxOutputMode,
  type Json2docxSettings,
  readJson2docxSettingsFromStorage,
  writeJson2docxSettingsToStorage,
} from "@/lib/json2docx/settings";
import { cn } from "@/lib/utils";

type HealthState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "disabled" }
  | { status: "online"; version: string }
  | { status: "offline"; error: string };

function healthLabel(state: HealthState): string {
  switch (state.status) {
    case "checking":
      return "Checking json2docx…";
    case "disabled":
      return "json2docx disabled";
    case "online":
      return state.version
        ? `json2docx connected (v${state.version})`
        : "json2docx connected";
    case "offline":
      return `json2docx offline (${state.error})`;
    default:
      return "json2docx…";
  }
}

export function Json2DocxSettingsCard() {
  const [enabled, setEnabled] = useState(DEFAULT_JSON2DOCX_SETTINGS.enabled);
  const [baseUrl, setBaseUrl] = useState(DEFAULT_JSON2DOCX_SETTINGS.baseUrl);
  const [outputMode, setOutputMode] = useState<Json2docxOutputMode>(
    DEFAULT_JSON2DOCX_SETTINGS.outputMode,
  );
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [health, setHealth] = useState<HealthState>({ status: "idle" });

  const applySettings = useCallback((settings: Json2docxSettings) => {
    setEnabled(settings.enabled);
    setBaseUrl(settings.baseUrl);
    setOutputMode(settings.outputMode);
  }, []);

  const refreshHealth = useCallback(async (settings: Json2docxSettings) => {
    if (!settings.enabled) {
      setHealth({ status: "disabled" });
      return { ok: false as const, error: "disabled" };
    }
    setHealth({ status: "checking" });
    const result = await fetchJson2docxHealth(settings.baseUrl);
    if (result.ok) {
      setHealth({ status: "online", version: result.version });
    } else {
      setHealth({ status: "offline", error: result.error });
    }
    return result;
  }, []);

  useEffect(() => {
    const settings = readJson2docxSettingsFromStorage();
    applySettings(settings);
    void refreshHealth(settings);
  }, [applySettings, refreshHealth]);

  const currentSettings = (): Json2docxSettings => ({
    enabled,
    baseUrl,
    outputMode,
  });

  const save = async () => {
    setSaving(true);
    try {
      const next = writeJson2docxSettingsToStorage(currentSettings());
      applySettings(next);
      toast.success("json2docx settings saved.");
      const result = await refreshHealth(next);
      if (next.enabled && !result.ok && result.error !== "disabled") {
        toast.error(`json2docx offline: ${result.error}`);
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to save json2docx settings.",
      );
    } finally {
      setSaving(false);
    }
  };

  const testConnection = async () => {
    setTesting(true);
    try {
      const next = writeJson2docxSettingsToStorage(currentSettings());
      applySettings(next);
      if (!next.enabled) {
        setHealth({ status: "disabled" });
        toast.error("Enable json2docx first, then test.");
        return;
      }
      const result = await refreshHealth(next);
      if (result.ok) {
        toast.success(
          result.version
            ? `json2docx connection OK (v${result.version}).`
            : "json2docx connection OK.",
        );
      } else {
        toast.error(`json2docx offline: ${result.error}`);
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "json2docx connection failed.",
      );
    } finally {
      setTesting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>json2docx local server</CardTitle>
        <CardDescription>
          Convert built resume JSON to DOCX/PDF via the local Python server
          (<code>json2docx/server.py</code>). Used by Resume Builder and the Chrome
          extension Generate Files flow.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span
            className={cn(
              "inline-block h-2 w-2 rounded-full bg-muted-foreground/50",
              health.status === "online" && "bg-emerald-500",
              health.status === "offline" && "bg-destructive",
              health.status === "checking" && "bg-amber-500",
            )}
            aria-hidden
          />
          <span>{healthLabel(health)}</span>
        </div>

        <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
          <div className="space-y-0.5">
            <Label htmlFor="json2docxEnabled">Enable local json2docx</Label>
            <p className="text-xs text-muted-foreground">
              Requires the server running on this machine (`python server.py`).
            </p>
          </div>
          <Switch
            id="json2docxEnabled"
            checked={enabled}
            onCheckedChange={setEnabled}
            aria-label="Enable local json2docx"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="json2docxBaseUrl">Server URL</Label>
          <Input
            id="json2docxBaseUrl"
            type="url"
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            placeholder="http://127.0.0.1:8765"
            autoComplete="off"
            spellCheck={false}
          />
          <p className="text-xs text-muted-foreground">
            Default: <code>{DEFAULT_JSON2DOCX_SETTINGS.baseUrl}</code>
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="json2docxOutputMode">Default output mode</Label>
          <Select
            value={outputMode}
            onValueChange={(value) => setOutputMode(value as Json2docxOutputMode)}
          >
            <SelectTrigger id="json2docxOutputMode" className="w-full">
              <SelectValue placeholder="Choose output mode" />
            </SelectTrigger>
            <SelectContent>
              {JSON2DOCX_OUTPUT_MODES.map((mode) => (
                <SelectItem key={mode} value={mode}>
                  {mode === "docx"
                    ? "DOCX only"
                    : mode === "pdf"
                      ? "PDF only"
                      : "DOCX + PDF"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Extension Register auto-attaches DOCX only. PDFs still save to Downloads when using DOCX + PDF.
          </p>
        </div>

        <div className="flex flex-wrap justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => void testConnection()}
            disabled={testing || saving}
          >
            {testing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Test connection
          </Button>
          <Button type="button" onClick={() => void save()} disabled={saving || testing}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
