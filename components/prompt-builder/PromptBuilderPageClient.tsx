"use client";

import React, { useEffect, useState } from "react";
import JobsLayout from "@/app/jobs-layout";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  buildPrompt,
  DEFAULT_PROMPT_TEMPLATE,
  PROMPT_BUILDER_STORAGE_KEYS,
  REQUIRED_BUILT_RESUME_JSON_FIELDS,
} from "@/lib/promptBuilder";

function FieldBlock({
  id,
  label,
  hint,
  value,
  onChange,
  onClear,
  headerActions,
  readOnly = false,
  placeholder,
  mono = false,
  rows = 8,
  grow = false,
}: {
  id: string;
  label: string;
  hint?: string;
  value: string;
  onChange?: (value: string) => void;
  onClear?: () => void;
  headerActions?: React.ReactNode;
  readOnly?: boolean;
  placeholder?: string;
  mono?: boolean;
  rows?: number;
  grow?: boolean;
}) {
  return (
    <div className={cn("flex min-h-0 w-full flex-col gap-1.5", grow && "h-full flex-1")}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 shrink-0">
          <label htmlFor={id} className="text-sm font-medium text-foreground">
            {label}
          </label>
          {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
        </div>
        {headerActions ? (
          <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-1.5">
            {headerActions}
          </div>
        ) : onClear ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 shrink-0 px-2 text-xs"
            onClick={onClear}
          >
            Clear
          </Button>
        ) : null}
      </div>
      <Textarea
        id={id}
        value={value}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        readOnly={readOnly}
        placeholder={placeholder}
        rows={rows}
        spellCheck={false}
        className={cn(
          "field-sizing-fixed w-full resize-y text-sm leading-relaxed",
          mono && "font-mono text-xs",
          grow ? "min-h-[200px] flex-1" : "min-h-[120px]",
        )}
      />
    </div>
  );
}

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
      toast.warning(`Built with empty: ${missingPlaceholders.join(", ")}`);
      return;
    }
    toast.success("Prompt built");
  };

  const handleBuildAndCopy = async () => {
    const { prompt, missingPlaceholders } = buildPrompt(
      template,
      resumeTemplateJson,
      jobDescription,
    );
    setOutput(prompt);
    if (!prompt.trim()) {
      toast.error("Nothing to copy.");
      return;
    }
    try {
      await navigator.clipboard.writeText(prompt);
      if (missingPlaceholders.length > 0) {
        toast.warning(`Copied (empty: ${missingPlaceholders.join(", ")})`);
      } else {
        toast.success("Built and copied");
      }
    } catch {
      toast.error("Built, but copy failed");
    }
  };

  const handleCopy = async () => {
    if (!output.trim()) {
      toast.error("Build a prompt first.");
      return;
    }
    try {
      await navigator.clipboard.writeText(output);
      toast.success("Copied");
    } catch {
      toast.error("Copy failed");
    }
  };

  const handleClearAll = () => {
    setTemplate(DEFAULT_PROMPT_TEMPLATE);
    setResumeTemplateJson("");
    setJobDescription("");
    setOutput("");
    toast.success("Cleared all");
  };

  const handleResetTemplate = () => {
    setTemplate(DEFAULT_PROMPT_TEMPLATE);
    toast.success("Template reset");
  };

  const handleClearInputs = () => {
    setResumeTemplateJson("");
    setJobDescription("");
    toast.success("Inputs cleared");
  };

  return (
    <JobsLayout>
      <div className="flex h-full min-h-0 w-full flex-col gap-4">
        <header className="shrink-0">
          <h1 className="text-lg font-semibold">Prompt Builder</h1>
          <p className="text-xs text-muted-foreground">
            Placeholders: {"{resume_template_json}"}, {"{job_description}"}. Built JSON must include{" "}
            {REQUIRED_BUILT_RESUME_JSON_FIELDS.map((field) => (
              <code key={field} className="mx-0.5">
                {field}
              </code>
            ))}
            .
          </p>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-2 lg:items-stretch">
          <div className="flex min-h-0 flex-col gap-4">
            <FieldBlock
              id="prompt-template"
              label="Original prompt"
              hint="Template with placeholders. Reset template loads the latest default (includes required job fields)."
              value={template}
              onChange={setTemplate}
              onClear={() => setTemplate("")}
              mono
              rows={8}
              grow
            />

            <FieldBlock
              id="resume-template-json"
              label="resume_template_json"
              hint='Include "resume_template" (e.g. Jose / Oscar) in the base JSON when possible.'
              value={resumeTemplateJson}
              onChange={setResumeTemplateJson}
              onClear={() => setResumeTemplateJson("")}
              placeholder='{"resume_template":"Jose","profile_title":{...}}'
              mono
              rows={6}
            />

            <FieldBlock
              id="job-description"
              label="job_description"
              value={jobDescription}
              onChange={setJobDescription}
              onClear={() => setJobDescription("")}
              placeholder="Paste job description..."
              rows={6}
            />
          </div>

          <FieldBlock
            id="prompt-output"
            label="Final prompt"
            hint="Click Build to generate"
            value={output}
            readOnly
            placeholder="Output appears here..."
            mono
            rows={20}
            grow
            headerActions={
              <>
                <Button type="button" size="sm" onClick={handleBuild}>
                  Build
                </Button>
                <Button type="button" size="sm" variant="secondary" onClick={handleBuildAndCopy}>
                  Build + Copy
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={handleCopy} disabled={!output.trim()}>
                  Copy
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={handleResetTemplate}>
                  Reset template
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={handleClearInputs}>
                  Clear inputs
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={handleClearAll}>
                  Clear all
                </Button>
              </>
            }
          />
        </div>
      </div>
    </JobsLayout>
  );
}
