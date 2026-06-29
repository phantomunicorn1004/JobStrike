"use client";

import React, { useEffect, useState } from "react";
import JobsLayout from "@/app/jobs-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Copy, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  buildPrompt,
  DEFAULT_PROMPT_TEMPLATE,
  PROMPT_BUILDER_STORAGE_KEYS,
} from "@/lib/promptBuilder";

export function PromptBuilderPageClient() {
  const [template, setTemplate] = useState(DEFAULT_PROMPT_TEMPLATE);
  const [resumeTemplateJson, setResumeTemplateJson] = useState("");
  const [jobDescription, setJobDescription] = useState("");
  const [output, setOutput] = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const savedTemplate = localStorage.getItem(PROMPT_BUILDER_STORAGE_KEYS.template);
      const savedResumeJson = localStorage.getItem(PROMPT_BUILDER_STORAGE_KEYS.resumeTemplateJson);
      const savedJobDescription = localStorage.getItem(PROMPT_BUILDER_STORAGE_KEYS.jobDescription);
      const savedOutput = localStorage.getItem(PROMPT_BUILDER_STORAGE_KEYS.output);

      if (savedTemplate !== null) setTemplate(savedTemplate);
      if (savedResumeJson !== null) setResumeTemplateJson(savedResumeJson);
      if (savedJobDescription !== null) setJobDescription(savedJobDescription);
      if (savedOutput !== null) setOutput(savedOutput);
    } catch {
      // ignore localStorage errors
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(PROMPT_BUILDER_STORAGE_KEYS.template, template);
      localStorage.setItem(PROMPT_BUILDER_STORAGE_KEYS.resumeTemplateJson, resumeTemplateJson);
      localStorage.setItem(PROMPT_BUILDER_STORAGE_KEYS.jobDescription, jobDescription);
      localStorage.setItem(PROMPT_BUILDER_STORAGE_KEYS.output, output);
    } catch {
      // ignore localStorage errors
    }
  }, [loaded, template, resumeTemplateJson, jobDescription, output]);

  const handleBuild = () => {
    const { prompt, missingPlaceholders } = buildPrompt(
      template,
      resumeTemplateJson,
      jobDescription,
    );

    setOutput(prompt);

    if (missingPlaceholders.length > 0) {
      toast.warning(
        `Built with empty values for: ${missingPlaceholders.join(", ")}`,
      );
      return;
    }

    toast.success("Prompt built");
  };

  const handleCopy = async () => {
    if (!output.trim()) {
      toast.error("Nothing to copy. Build a prompt first.");
      return;
    }

    try {
      await navigator.clipboard.writeText(output);
      toast.success("Copied to clipboard");
    } catch {
      toast.error("Could not copy to clipboard");
    }
  };

  const handleClear = () => {
    setTemplate(DEFAULT_PROMPT_TEMPLATE);
    setResumeTemplateJson("");
    setJobDescription("");
    setOutput("");
    toast.success("Cleared");
  };

  return (
    <JobsLayout>
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-4 md:p-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Prompt Builder</h1>
          <p className="text-sm text-muted-foreground">
            Merge a prompt template with resume JSON and a job description into one copy-ready prompt.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">1. Original prompt</CardTitle>
            <CardDescription>
              Include placeholders{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">{"{resume_template_json}"}</code>{" "}
              and{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">{"{job_description}"}</code>.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Label htmlFor="prompt-template" className="sr-only">
              Original prompt
            </Label>
            <Textarea
              id="prompt-template"
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
              rows={14}
              className="min-h-[220px] font-mono text-xs leading-relaxed md:text-sm"
              spellCheck={false}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">2. resume_template_json</CardTitle>
            <CardDescription>Paste resume JSON exactly as you want it inserted.</CardDescription>
          </CardHeader>
          <CardContent>
            <Label htmlFor="resume-template-json" className="sr-only">
              resume_template_json
            </Label>
            <Textarea
              id="resume-template-json"
              value={resumeTemplateJson}
              onChange={(e) => setResumeTemplateJson(e.target.value)}
              rows={12}
              className="min-h-[180px] font-mono text-xs leading-relaxed md:text-sm"
              placeholder='{"profileTitle":"...","professionalSummary":"...","experience":[...]}'
              spellCheck={false}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">3. job_description</CardTitle>
            <CardDescription>Paste the full job description text.</CardDescription>
          </CardHeader>
          <CardContent>
            <Label htmlFor="job-description" className="sr-only">
              job_description
            </Label>
            <Textarea
              id="job-description"
              value={jobDescription}
              onChange={(e) => setJobDescription(e.target.value)}
              rows={12}
              className="min-h-[180px] text-sm leading-relaxed"
              placeholder="Paste job description here..."
              spellCheck={false}
            />
          </CardContent>
        </Card>

        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={handleBuild}>
            <Sparkles className="mr-2 h-4 w-4" />
            Build prompt
          </Button>
          <Button type="button" variant="outline" onClick={handleClear}>
            <Trash2 className="mr-2 h-4 w-4" />
            Clear all
          </Button>
        </div>

        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
            <div className="space-y-1.5">
              <CardTitle className="text-base">Final prompt</CardTitle>
              <CardDescription>
                Generated only when you click Build prompt.
              </CardDescription>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleCopy}
              disabled={!output.trim()}
            >
              <Copy className="mr-2 h-4 w-4" />
              Copy
            </Button>
          </CardHeader>
          <CardContent>
            <Textarea
              readOnly
              value={output}
              rows={16}
              className="min-h-[260px] font-mono text-xs leading-relaxed md:text-sm"
              placeholder="Your merged prompt will appear here after you click Build prompt."
            />
          </CardContent>
        </Card>
      </div>
    </JobsLayout>
  );
}
