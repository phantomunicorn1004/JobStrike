"use client";

import React, { useState } from "react";
import { Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AutobidJob } from "@/lib/autobid/stages";

/**
 * One input per question Auto-bid stopped on. The answers are saved on the
 * candidate's profile (Saved form answers) and the job is tried again; later
 * forms asking the same question fill themselves.
 */
export function AnswerForm({ job, onDone }: { job: AutobidJob; onDone: () => void }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  if (!job.missingFields.length) return null;

  const answers = job.missingFields
    .map((question) => ({ question, answer: (values[question] ?? "").trim() }))
    .filter((entry) => entry.answer);

  const submit = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/autobid/answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ id: job.id, answers }),
      });
      const data = (await res.json().catch(() => ({}))) as { saved?: number; retried?: boolean; error?: string };
      if (!res.ok) throw new Error(data.error || "Could not save the answers.");
      toast.success(
        data.retried
          ? "Saved to the profile. The job will be tried again."
          : "Saved to the profile. This job was not retried (Submit was already pressed); later forms will use the answer.",
      );
      setValues({});
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the answers.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="space-y-2 rounded-lg border border-border/70 bg-background px-3 py-3"
      onClick={(e) => e.stopPropagation()}
      onSubmit={(e) => {
        e.preventDefault();
        if (answers.length && !busy) void submit();
      }}
    >
      <p className="text-xs font-medium">Answer once — saved for {job.candidate || "this candidate"} and used on every later form</p>
      {job.missingFields.map((question) => (
        <label key={question} className="block space-y-1">
          <span className="block text-xs text-muted-foreground">{question}</span>
          <Input
            value={values[question] ?? ""}
            onChange={(e) => setValues((prev) => ({ ...prev, [question]: e.target.value }))}
            className="h-8 text-sm"
            placeholder="Your answer"
          />
        </label>
      ))}
      <div className="flex justify-end">
        <Button type="submit" size="sm" className="h-8" disabled={busy || !answers.length}>
          {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-1 h-3.5 w-3.5" />}
          Save &amp; retry
        </Button>
      </div>
    </form>
  );
}
