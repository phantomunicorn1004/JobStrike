"use client";

import React, { useState } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/** One form field of an attempt, as the JobStrike panel planned and filled it. */
type FieldEntry = {
  label: string;
  type: string;
  category: string;
  required: boolean;
  source: string;
  value: string;
  outcome: string;
  status: string;
  error: string;
  optionCount?: number;
  options?: string[];
};

const SOURCE_LABEL: Record<string, string> = {
  profile: "Profile",
  ai: "AI",
  learned: "Earlier answer",
  custom: "Saved answer",
  acknowledgment: "Acknowledgment",
  kit: "Resume",
  typed: "Typed",
  manual: "By hand",
  missing: "Missing in profile",
  optional: "Optional",
  suggested: "Suggested",
  voluntary: "Voluntary",
};

function outcomeStyle(entry: FieldEntry): string {
  if (entry.outcome === "filled") return "text-emerald-700 dark:text-emerald-400";
  if (entry.required) return "text-amber-700 dark:text-amber-400";
  return "text-muted-foreground";
}

function outcomeLabel(entry: FieldEntry): string {
  if (entry.outcome === "filled") return "Filled";
  if (entry.outcome === "empty on page") return "Empty on page";
  if (entry.outcome === "failed") return "Not filled";
  return entry.required ? "Left empty" : "Skipped";
}

/**
 * Every field of a job's last attempt: what was entered, where it came from
 * and how filling went. Loaded when opened, so the page's refresh stays small.
 */
export function FieldReport({ jobId }: { jobId: number }) {
  const [fields, setFields] = useState<FieldEntry[] | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const load = async () => {
    if (fields || loading) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/autobid/${jobId}/fields`, { credentials: "same-origin", cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as { fields?: FieldEntry[]; error?: string };
      if (!res.ok) throw new Error(data.error || "Could not load the form fields.");
      setFields(data.fields ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the form fields.");
    } finally {
      setLoading(false);
    }
  };

  const problems = (fields ?? []).filter((f) => f.required && f.outcome !== "filled").length;

  return (
    <details className="mt-2 text-xs" onToggle={(e) => (e.currentTarget as HTMLDetailsElement).open && void load()}>
      <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
        Form fields{fields ? ` (${fields.length}${problems ? `, ${problems} required not filled` : ""})` : ""}
      </summary>
      {loading && (
        <p className="mt-1.5 flex items-center gap-1.5 text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
        </p>
      )}
      {error && <p className="mt-1.5 text-rose-700 dark:text-rose-300">{error}</p>}
      {fields && fields.length === 0 && (
        <p className="mt-1.5 text-muted-foreground">No field report for this attempt (it ran before JobStrike 4.42.2).</p>
      )}
      {fields && fields.length > 0 && (
        <div className="mt-1.5 overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-1 pr-2 font-medium">Field</th>
                <th className="py-1 pr-2 font-medium">Type</th>
                <th className="py-1 pr-2 font-medium">From</th>
                <th className="py-1 pr-2 font-medium">Value</th>
                <th className="py-1 font-medium">Result</th>
              </tr>
            </thead>
            <tbody>
              {fields.map((entry, index) => (
                <tr key={`${entry.label}-${index}`} className="border-b align-top last:border-0">
                  <td className="py-1 pr-2">
                    {entry.label}
                    {entry.required && <span className="text-rose-600"> *</span>}
                  </td>
                  <td className="py-1 pr-2 text-muted-foreground">{entry.type || "—"}</td>
                  <td className="py-1 pr-2 text-muted-foreground">{SOURCE_LABEL[entry.source] ?? (entry.source || "—")}</td>
                  <td className="max-w-[220px] break-words py-1 pr-2">{entry.value || <span className="text-muted-foreground">—</span>}</td>
                  <td className={cn("py-1", outcomeStyle(entry))}>
                    {outcomeLabel(entry)}
                    {(entry.error || (entry.outcome !== "filled" && entry.status)) && (
                      <div className="text-muted-foreground">{entry.error || entry.status}</div>
                    )}
                    {entry.options && entry.options.length > 0 && (
                      <div className="text-muted-foreground" title={entry.options.join(" | ")}>
                        Options ({entry.optionCount}): {entry.options.slice(0, 4).join(", ")}
                        {(entry.optionCount ?? 0) > 4 ? "…" : ""}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </details>
  );
}
