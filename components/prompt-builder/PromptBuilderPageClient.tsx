"use client";

import React, { useEffect, useState } from "react";
import JobsLayout from "@/app/jobs-layout";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  buildPrompt,
  DEFAULT_PROMPT_TEMPLATE,
  PROMPT_BUILDER_STORAGE_KEYS,
} from "@/lib/promptBuilder";

function FieldBlock({
  id,
  label,
  hint,
  value,
  onChange,
  onClear,
  readOnly = false,
  placeholder,
  mono = false,
  rows = 8,
}: {
  id: string;
  label: string;
  hint?: string;
  value: string;
  onChange?: (value: string) => void;
  onClear?: () => void;
  readOnly?: boolean;
  placeholder?: string;
  mono?: boolean;
  rows?: number;
}) {
  return (
    <div className="flex w-full flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-foreground">
        {label}
      </label>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      <Textarea
        id={id}
        value={value}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        readOnly={readOnly}
        placeholder={placeholder}
        rows={rows}
        spellCheck={false}
        className={`field-sizing-fixed w-full min-h-[120px] resize-y text-sm leading-relaxed ${mono ? "font-mono text-xs" : ""}`}
      />
      {onClear ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 w-fit px-2 text-xs"
          onClick={onClear}
        >
          Clear
        </Button>
      ) : null}
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
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
        <header>
          <h1 className="text-lg font-semibold">Prompt Builder</h1>
          <p className="text-xs text-muted-foreground">
            Placeholders: {"{resume_template_json}"}, {"{job_description}"}
          </p>
        </header>

        <div className="flex w-full flex-col gap-5">
          <FieldBlock
            id="prompt-template"
            label="Original prompt"
            hint="Template with placeholders"
            value={template}
            onChange={setTemplate}
            onClear={() => setTemplate("")}
            mono
            rows={10}
          />

          <FieldBlock
            id="resume-template-json"
            label="resume_template_json"
            value={resumeTemplateJson}
            onChange={setResumeTemplateJson}
            onClear={() => setResumeTemplateJson("")}
            placeholder='{"profileTitle":"..."}'
            mono
            rows={8}
          />

          <FieldBlock
            id="job-description"
            label="job_description"
            value={jobDescription}
            onChange={setJobDescription}
            onClear={() => setJobDescription("")}
            placeholder="Paste job description..."
            rows={8}
          />
        </div>

        <div className="flex w-full flex-col gap-2">
          <Button type="button" className="w-full" onClick={handleBuild}>
            Build
          </Button>
          <Button type="button" variant="secondary" className="w-full" onClick={handleBuildAndCopy}>
            Build + Copy
          </Button>
          <Button type="button" variant="outline" className="w-full" onClick={handleCopy} disabled={!output.trim()}>
            Copy output
          </Button>
          <Button type="button" variant="outline" className="w-full" onClick={handleResetTemplate}>
            Reset template
          </Button>
          <Button type="button" variant="outline" className="w-full" onClick={handleClearInputs}>
            Clear inputs
          </Button>
          <Button type="button" variant="ghost" className="w-full" onClick={handleClearAll}>
            Clear all
          </Button>
        </div>

        <FieldBlock
          id="prompt-output"
          label="Final prompt"
          hint="Click Build to generate"
          value={output}
          readOnly
          placeholder="Output appears here..."
          mono
          rows={12}
        />
      </div>
    </JobsLayout>
  );
}
