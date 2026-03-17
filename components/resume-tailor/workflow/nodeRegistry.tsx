"use client";

import React from "react";
import {
  Play,
  FileUp,
  Sparkles,
  Scan,
  Download,
  FileText,
  ListChecks,
  LayoutTemplate,
  Map,
  FileCode,
  CheckCircle2,
  type LucideIcon,
} from "lucide-react";
import type { WorkflowNodeType, ResumeNodeType } from "./types";

export interface NodeDefinition {
  type: WorkflowNodeType;
  label: string;
  description: string;
  icon: LucideIcon;
  iconBg: string;
  border: string;
  badge: string;
}

const STYLE_INPUT = {
  iconBg: "bg-blue-500/20 text-blue-600 dark:text-blue-400",
  border: "border-blue-500/40",
  badge: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
};
const STYLE_AI = {
  iconBg: "bg-violet-500/20 text-violet-600 dark:text-violet-400",
  border: "border-violet-500/40",
  badge: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
};
const STYLE_TRANSFORM = {
  iconBg: "bg-amber-500/20 text-amber-600 dark:text-amber-400",
  border: "border-amber-500/40",
  badge: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
};
const STYLE_OUTPUT = {
  iconBg: "bg-cyan-500/20 text-cyan-600 dark:text-cyan-400",
  border: "border-cyan-500/40",
  badge: "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300",
};
const STYLE_TRIGGER = {
  iconBg: "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400",
  border: "border-emerald-500/40",
  badge: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
};

/** Registry of all workflow node types (resume + legacy). */
export const NODE_REGISTRY: Record<WorkflowNodeType, NodeDefinition> = {
  // Legacy
  trigger: {
    type: "trigger",
    label: "Trigger",
    description: "Start the workflow",
    icon: Play,
    ...STYLE_TRIGGER,
  },
  input: {
    type: "input",
    label: "Input",
    description: "Input data",
    icon: FileUp,
    ...STYLE_INPUT,
  },
  ai: {
    type: "ai",
    label: "AI",
    description: "AI processing",
    icon: Sparkles,
    ...STYLE_AI,
  },
  transform: {
    type: "transform",
    label: "Transform",
    description: "Transform data",
    icon: Scan,
    ...STYLE_TRANSFORM,
  },
  output: {
    type: "output",
    label: "Output",
    description: "Output result",
    icon: Download,
    ...STYLE_OUTPUT,
  },
  // Resume workflow nodes
  initialInput: {
    type: "initialInput",
    label: "Initial Input",
    description: "Job info and options",
    icon: FileText,
    ...STYLE_TRIGGER,
  },
  resumeSelection: {
    type: "resumeSelection",
    label: "Resume Selection",
    description: "Choose one JSON resume",
    icon: FileUp,
    ...STYLE_INPUT,
  },
  jdParsing: {
    type: "jdParsing",
    label: "JD Parsing",
    description: "Parse and normalize job description",
    icon: ListChecks,
    ...STYLE_TRANSFORM,
  },
  tailorAi: {
    type: "tailorAi",
    label: "Tailor AI",
    description: "Tailor resume to JD with AI",
    icon: Sparkles,
    ...STYLE_AI,
  },
  resumeValidation: {
    type: "resumeValidation",
    label: "Resume Validation",
    description: "Validate tailored resume schema",
    icon: CheckCircle2,
    ...STYLE_TRANSFORM,
  },
  templateSelection: {
    type: "templateSelection",
    label: "Template Selection",
    description: "Choose PDF resume template",
    icon: LayoutTemplate,
    ...STYLE_INPUT,
  },
  resumeToTemplateMapping: {
    type: "resumeToTemplateMapping",
    label: "Resume-to-Template Mapping",
    description: "Map resume data to template",
    icon: Map,
    ...STYLE_TRANSFORM,
  },
  pdfBuild: {
    type: "pdfBuild",
    label: "PDF Build",
    description: "Generate PDF from template",
    icon: FileCode,
    ...STYLE_TRANSFORM,
  },
  download: {
    type: "download",
    label: "Download",
    description: "PDF, JSON, and ATS results",
    icon: Download,
    ...STYLE_OUTPUT,
  },
};

export const RESUME_NODE_TYPES: ResumeNodeType[] = [
  "initialInput",
  "resumeSelection",
  "jdParsing",
  "tailorAi",
  "resumeValidation",
  "templateSelection",
  "resumeToTemplateMapping",
  "pdfBuild",
  "download",
];

export function getNodeDefinition(type: WorkflowNodeType): NodeDefinition {
  const def = NODE_REGISTRY[type];
  if (def) return def;
  return NODE_REGISTRY.input;
}
