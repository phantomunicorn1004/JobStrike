"use client";

import React, { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

const OPENAI_API_KEY_STORAGE_KEY = "resumeTailorWorkflowOpenaiApiKey";

export function getWorkflowOpenaiApiKey(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(OPENAI_API_KEY_STORAGE_KEY);
}

type WorkflowSettingsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function WorkflowSettingsDialog({ open, onOpenChange }: WorkflowSettingsDialogProps) {
  const [openaiApiKey, setOpenaiApiKey] = useState("");

  useEffect(() => {
    if (open) {
      setOpenaiApiKey(getWorkflowOpenaiApiKey() ?? "");
    }
  }, [open]);

  const handleSave = () => {
    localStorage.setItem(OPENAI_API_KEY_STORAGE_KEY, openaiApiKey.trim());
    toast.success("Settings saved. API key is stored locally and not shared with the workflow data.");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Workflow settings</DialogTitle>
          <DialogDescription>
            Configure credentials used by JD Parsing and Tailor AI nodes. Stored only on this device.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label htmlFor="workflow-openai-key">OpenAI API key</Label>
            <Input
              id="workflow-openai-key"
              type="password"
              value={openaiApiKey}
              onChange={(e) => setOpenaiApiKey(e.target.value)}
              placeholder="sk-... (leave blank to use project default)"
              className="mt-1 font-mono text-xs"
              autoComplete="off"
            />
            <p className="text-muted-foreground text-xs mt-1">
              Leave blank to use the project’s registered OpenAI credential (e.g. env).
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
