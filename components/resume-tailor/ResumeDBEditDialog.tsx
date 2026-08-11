"use client";

import React, { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { ResumeDbRow } from "./ResumeDBPageClient";

type Props = {
  row: ResumeDbRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (updated: Partial<ResumeDbRow>) => void;
};

export function ResumeDBEditDialog({ row, open, onOpenChange, onSaved }: Props) {
  const [company, setCompany] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [jobLink, setJobLink] = useState("");
  const [note, setNote] = useState("");
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!row || !open) return;
    setCompany(row.company || "");
    setJobTitle(row.jobTitle || "");
    setJobLink(row.jobLink || "");
    setNote(row.note || "");
    setResumeFile(null);
    setCoverFile(null);
  }, [row, open]);

  const handleSave = async () => {
    if (!row) return;
    if (!company.trim() || !jobTitle.trim()) {
      toast.error("Company and job title are required.");
      return;
    }
    setSaving(true);
    try {
      const formData = new FormData();
      formData.append("id", String(row.rowIndex));
      formData.append("companyName", company.trim());
      formData.append("jobTitle", jobTitle.trim());
      formData.append("jobLink", jobLink.trim());
      formData.append("note", note.trim());
      if (resumeFile) formData.append("resume", resumeFile, resumeFile.name);
      if (coverFile) formData.append("coverLetter", coverFile, coverFile.name);

      const res = await fetch("/api/resume-db/update", {
        method: "POST",
        body: formData,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Update failed");
      }
      toast.success("Application updated.");
      onSaved({
        rowIndex: row.rowIndex,
        company: data.company ?? company.trim(),
        jobTitle: data.jobTitle ?? jobTitle.trim(),
        jobLink: data.jobLink ?? jobLink.trim(),
        note: data.note ?? note.trim(),
        resumeUrl: data.resumeUrl ?? row.resumeUrl,
        coverLetterUrl: data.coverLetterUrl ?? row.coverLetterUrl,
        inPipeline: data.inPipeline ?? row.inPipeline,
        pipelineStageId: data.pipelineStageId ?? row.pipelineStageId,
      });
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Update failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(85vh,720px)] max-w-md flex-col gap-0 overflow-hidden rounded-2xl p-0">
        <DialogHeader className="shrink-0 border-b border-border/60 px-6 py-4 pr-12">
          <DialogTitle>Edit application</DialogTitle>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4">
          <div className="grid gap-2">
            <Label htmlFor="edit-company">Company</Label>
            <Input
              id="edit-company"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="edit-title">Job title</Label>
            <Input
              id="edit-title"
              value={jobTitle}
              onChange={(e) => setJobTitle(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="edit-link">Job link</Label>
            <Input
              id="edit-link"
              type="url"
              value={jobLink}
              onChange={(e) => setJobLink(e.target.value)}
              placeholder="https://…"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="edit-note">Note</Label>
            <Textarea
              id="edit-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Extra job description or notes…"
              rows={5}
              className="field-sizing-fixed h-36 max-h-36 min-h-36 resize-none overflow-y-auto break-words"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="edit-resume">Replace resume (optional)</Label>
            <Input
              id="edit-resume"
              type="file"
              accept=".pdf,.docx,.doc"
              onChange={(e) => setResumeFile(e.target.files?.[0] ?? null)}
            />
            {row?.resumeUrl && !resumeFile && (
              <p className="text-xs text-muted-foreground truncate">
                Current file linked — leave empty to keep.
              </p>
            )}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="edit-cover">Replace cover letter (optional)</Label>
            <Input
              id="edit-cover"
              type="file"
              accept=".pdf,.docx,.doc,.txt"
              onChange={(e) => setCoverFile(e.target.files?.[0] ?? null)}
            />
            {row?.coverLetterUrl && !coverFile && (
              <p className="text-xs text-muted-foreground truncate">
                Current file linked — leave empty to keep.
              </p>
            )}
          </div>
        </div>
        <DialogFooter className="shrink-0 gap-2 border-t border-border/60 px-6 py-4 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Saving…
              </>
            ) : (
              "Save changes"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
