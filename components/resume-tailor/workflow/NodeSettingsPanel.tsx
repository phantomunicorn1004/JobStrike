"use client";

import React from "react";
import type { WorkflowNode as WorkflowNodeType, WorkflowState } from "./types";
import { getNodeDefinition } from "./nodeRegistry";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TEMPLATE_CONFIGS, type TemplateId } from "@/lib/resumeTemplates/types";

interface NodeSettingsPanelProps {
  node: WorkflowNodeType;
  workflow: WorkflowState;
  onWorkflowChange: (workflow: WorkflowState) => void;
}

function updateNodeData(
  workflow: WorkflowState,
  nodeId: string,
  updates: Partial<WorkflowNodeType> | ((data: Record<string, unknown>) => Record<string, unknown>)
): WorkflowState {
  return {
    ...workflow,
    nodes: workflow.nodes.map((n) => {
      if (n.id !== nodeId) return n;
      if (typeof updates === "function") {
        return { ...n, data: { ...n.data, ...updates(n.data ?? {}) } };
      }
      return { ...n, ...updates };
    }),
  };
}

export function NodeSettingsPanel({
  node,
  workflow,
  onWorkflowChange,
}: NodeSettingsPanelProps) {
  const def = getNodeDefinition(node.type);
  const data = node.data ?? {};

  const setData = (key: string, value: unknown) => {
    onWorkflowChange(updateNodeData(workflow, node.id, { data: { ...data, [key]: value } }));
  };

  const setLabel = (label: string) => {
    onWorkflowChange(updateNodeData(workflow, node.id, { label }));
  };

  switch (node.type) {
    case "initialInput": {
      const jobTitle = (data.jobTitle as string) ?? "";
      const companyName = (data.companyName as string) ?? "";
      const jobDescription = (data.jobDescription as string) ?? "";
      const jobLink = (data.jobLink as string) ?? "";
      const resumeId = (data.resumeId as string) ?? "";
      const templateId = (data.templateId as TemplateId) ?? "modern";
      const options = (data.options as { maxPages?: number; tone?: string; atsMode?: boolean; preserveJobOrder?: boolean }) ?? {};
      return (
        <div className="space-y-3 text-sm">
          <p className="text-muted-foreground text-xs">{def.description}</p>
          <div>
            <Label>Job Title</Label>
            <Input
              value={jobTitle}
              onChange={(e) => setData("jobTitle", e.target.value)}
              placeholder="e.g. Senior Engineer"
              className="mt-1"
            />
          </div>
          <div>
            <Label>Company Name</Label>
            <Input
              value={companyName}
              onChange={(e) => setData("companyName", e.target.value)}
              placeholder="e.g. Acme Inc."
              className="mt-1"
            />
          </div>
          <div>
            <Label>Job Description</Label>
            <Textarea
              value={jobDescription}
              onChange={(e) => setData("jobDescription", e.target.value)}
              placeholder="Paste job description..."
              className="mt-1 min-h-[80px]"
            />
          </div>
          <div>
            <Label>Job Link (optional)</Label>
            <Input
              value={jobLink}
              onChange={(e) => setData("jobLink", e.target.value)}
              placeholder="https://..."
              className="mt-1"
            />
          </div>
          <div>
            <Label>Resume ID</Label>
            <Input
              value={resumeId}
              onChange={(e) => setData("resumeId", e.target.value)}
              placeholder="Resume identifier"
              className="mt-1"
            />
          </div>
          <div>
            <Label>Default Template</Label>
            <Select
              value={templateId}
              onValueChange={(v) => setData("templateId", v as TemplateId)}
            >
              <SelectTrigger className="mt-1 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(TEMPLATE_CONFIGS).map(([id, config]) => (
                  <SelectItem key={id} value={id}>
                    {config.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-wrap gap-2 pt-2">
            <Label className="w-full">Options</Label>
            <div className="flex items-center gap-2">
              <Label className="text-xs">Max pages</Label>
              <Input
                type="number"
                min={1}
                max={5}
                value={options.maxPages ?? 2}
                onChange={(e) =>
                  setData("options", { ...options, maxPages: parseInt(e.target.value, 10) || 2 })
                }
                className="w-16"
              />
            </div>
            <div className="flex items-center gap-2">
              <Label className="text-xs">Tone</Label>
              <Input
                value={options.tone ?? "professional"}
                onChange={(e) => setData("options", { ...options, tone: e.target.value })}
                className="w-28"
              />
            </div>
            <div className="flex items-center gap-2">
              <Label className="text-xs">ATS mode</Label>
              <input
                type="checkbox"
                checked={options.atsMode !== false}
                onChange={(e) => setData("options", { ...options, atsMode: e.target.checked })}
                className="rounded"
              />
            </div>
          </div>
        </div>
      );
    }

    case "resumeSelection":
      return (
        <div className="space-y-3 text-sm">
          <p className="text-muted-foreground text-xs">{def.description}</p>
          <p className="text-muted-foreground text-xs">
            Resume is loaded by ID from Initial Input. Ensure resume is stored in your profile or
            paste JSON when running.
          </p>
        </div>
      );

    case "jdParsing":
      return (
        <div className="space-y-3 text-sm">
          <p className="text-muted-foreground text-xs">{def.description}</p>
          <p className="text-muted-foreground text-xs">
            Extracts skills, responsibilities, and seniority from the job description. No settings
            required.
          </p>
        </div>
      );

    case "tailorAi": {
      const model = (data.model as string) ?? "gpt-4o-mini";
      return (
        <div className="space-y-3 text-sm">
          <p className="text-muted-foreground text-xs">{def.description}</p>
          <div>
            <Label>Model</Label>
            <Input
              value={model}
              onChange={(e) => setData("model", e.target.value)}
              placeholder="gpt-4o-mini"
              className="mt-1"
            />
          </div>
          <p className="text-muted-foreground text-xs">
            Uses project OpenAI config. Tailoring preserves truthfulness and does not fabricate
            experience.
          </p>
        </div>
      );
    }

    case "resumeValidation":
      return (
        <div className="space-y-3 text-sm">
          <p className="text-muted-foreground text-xs">{def.description}</p>
          <p className="text-muted-foreground text-xs">
            Validates tailored resume against schema. Rejects malformed fields; optional safe
            fallback.
          </p>
        </div>
      );

    case "templateSelection": {
      const templateId = (data.templateId as TemplateId) ?? "modern";
      return (
        <div className="space-y-3 text-sm">
          <p className="text-muted-foreground text-xs">{def.description}</p>
          <div>
            <Label>Template</Label>
            <Select
              value={templateId}
              onValueChange={(v) => setData("templateId", v as TemplateId)}
            >
              <SelectTrigger className="mt-1 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(TEMPLATE_CONFIGS).map(([id, config]) => (
                  <SelectItem key={id} value={id}>
                    {config.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      );
    }

    case "resumeToTemplateMapping":
    case "pdfBuild":
    case "download":
      return (
        <div className="space-y-3 text-sm">
          <p className="text-muted-foreground text-xs">{def.description}</p>
          <p className="text-muted-foreground text-xs">No configurable settings. Uses upstream data.</p>
        </div>
      );

    default: {
      // Legacy or unknown: allow editing label
      return (
        <div className="space-y-3 text-sm">
          <p className="text-muted-foreground text-xs">{def.description}</p>
          <div>
            <Label>Label</Label>
            <Input
              value={node.label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Node label"
              className="mt-1"
            />
          </div>
        </div>
      );
    }
  }
}
