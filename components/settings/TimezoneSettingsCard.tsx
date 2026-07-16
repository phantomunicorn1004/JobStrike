"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type TimezoneOption = {
  id: string;
  label: string;
};

type TimezoneStatus = {
  timezone: string;
  label: string;
  options: TimezoneOption[];
};

export function TimezoneSettingsCard() {
  const [status, setStatus] = useState<TimezoneStatus | null>(null);
  const [timezone, setTimezone] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/settings/timezone", {
        credentials: "same-origin",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to load timezone.");
      setStatus(data);
      setTimezone(data.timezone || "");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to load timezone.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const save = async () => {
    if (!timezone) return;
    setSaving(true);
    try {
      const res = await fetch("/api/settings/timezone", {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timezone }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to save timezone.");
      setStatus(data);
      setTimezone(data.timezone || timezone);
      toast.success("Timezone saved.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to save timezone.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Timezone</CardTitle>
        <CardDescription>
          Choose the timezone used for Dashboard counts, Resume DB dates, and date filters.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading timezone…
          </div>
        ) : (
          <>
            <div className="space-y-2">
              <Label htmlFor="timezoneSelect">Website timezone</Label>
              <Select value={timezone} onValueChange={setTimezone}>
                <SelectTrigger id="timezoneSelect" className="w-full">
                  <SelectValue placeholder="Choose a timezone" />
                </SelectTrigger>
                <SelectContent>
                  {(status?.options ?? []).map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <p className="text-xs text-muted-foreground">
              Current default is Eastern time via <code>America/New_York</code>.
            </p>

            <div className="flex justify-end">
              <Button type="button" onClick={save} disabled={saving || !timezone}>
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Save timezone
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
