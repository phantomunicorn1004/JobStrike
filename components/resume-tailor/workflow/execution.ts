/**
 * Resume workflow execution runner.
 * Runs nodes in topological order and calls existing APIs.
 */

import type { WorkflowState, WorkflowNode } from "./types";
import type {
  WorkflowInput,
  WorkflowExecutionResult,
  NormalizedJobDescription,
  AtsAnalysis,
  TailorOutput,
  TemplateViewModel,
  PdfBuildOutput,
} from "./contracts";
import type { ResumeContent } from "@/lib/resumeTemplates/types";
import type { ResumeStructure } from "@/lib/resume/structure/types";
import type { TemplateId } from "@/lib/resumeTemplates/types";

export type NodeExecutionStatus = "idle" | "running" | "success" | "error";

export interface RunWorkflowOptions {
  /** Resume file for Resume Selection (required when no sheet row is selected). */
  resumeFile?: File | null;
  /** OpenAI API key from workflow Settings (used by JD Parsing and Tailor AI). */
  openaiApiKey?: string;
  /** Called when a node starts or finishes (for n8n-style status per node). */
  onNodeStatus?: (nodeId: string, status: NodeExecutionStatus, error?: string) => void;
}

interface ExecutionContext {
  workflowInput?: WorkflowInput;
  resume?: { content: ResumeContent; structure: ResumeStructure };
  tailoredStructure?: ResumeStructure;
  normalizedJd?: NormalizedJobDescription;
  tailorOutput?: TailorOutput;
  validatedResume?: ResumeContent;
  validationWarnings: string[];
  validationErrors: string[];
  templateId?: TemplateId;
  templateViewModel?: TemplateViewModel;
  formatMetadata?: { originalDocxBuffer?: string; docxParagraphsWithFormat?: unknown[] };
  pdfResult?: PdfBuildOutput;
}

function topologicalOrder(workflow: WorkflowState): WorkflowNode[] {
  const inDegree = new Map<string, number>();
  const outEdges = new Map<string, string[]>();
  for (const n of workflow.nodes) {
    inDegree.set(n.id, 0);
    outEdges.set(n.id, []);
  }
  for (const e of workflow.edges) {
    outEdges.get(e.sourceId)?.push(e.targetId);
    inDegree.set(e.targetId, (inDegree.get(e.targetId) ?? 0) + 1);
  }
  const queue = workflow.nodes.filter((n) => inDegree.get(n.id) === 0);
  const order: WorkflowNode[] = [];
  while (queue.length) {
    const n = queue.shift()!;
    order.push(n);
    for (const targetId of outEdges.get(n.id) ?? []) {
      const d = (inDegree.get(targetId) ?? 0) - 1;
      inDegree.set(targetId, d);
      if (d === 0) {
        const target = workflow.nodes.find((x) => x.id === targetId);
        if (target) queue.push(target);
      }
    }
  }
  return order;
}

function getInitialInput(workflow: WorkflowState): WorkflowInput | null {
  const node = workflow.nodes.find((n) => n.type === "initialInput");
  if (!node?.data) return null;
  const d = node.data as Record<string, unknown>;
  return {
    jobTitle: String(d.jobTitle ?? "").trim(),
    companyName: String(d.companyName ?? "").trim(),
    jobDescription: String(d.jobDescription ?? "").trim(),
    jobLink: d.jobLink ? String(d.jobLink).trim() : undefined,
    sheetRowIndex: d.sheetRowIndex
      ? String(d.sheetRowIndex).trim()
      : d.resumeId
        ? String(d.resumeId).trim()
        : undefined,
    templateId: (d.templateId as TemplateId) ?? "modern",
    options: d.options as WorkflowInput["options"],
  };
}

function normalizeJd(rawText: string): NormalizedJobDescription {
  const text = rawText.trim();
  const lines = text.split(/\n/).map((l) => l.trim()).filter(Boolean);
  const requiredSkills: string[] = [];
  const preferredSkills: string[] = [];
  const toolsAndTechnologies: string[] = [];
  const responsibilities: string[] = [];
  const industryTerms: string[] = [];
  for (const line of lines) {
    if (line.length > 10 && line.length < 200) {
      if (/required|must have|qualifications?/i.test(line)) requiredSkills.push(line);
      else if (/preferred|nice to have|bonus/i.test(line)) preferredSkills.push(line);
      else if (/responsibilities?|duties/i.test(line)) responsibilities.push(line);
      else industryTerms.push(line);
    }
  }
  return {
    requiredSkills,
    preferredSkills,
    toolsAndTechnologies,
    responsibilities,
    senioritySignals: [],
    industryTerms,
    rawText: text,
  };
}

function validateResumeContent(content: ResumeContent): { warnings: string[]; errors: string[] } {
  const warnings: string[] = [];
  const errors: string[] = [];
  if (!content.profileTitle?.trim()) errors.push("Profile title is required.");
  if (!content.experience?.length) errors.push("At least one experience entry is required.");
  if (!Array.isArray(content.experience)) errors.push("Experience must be an array.");
  if (content.experience?.some((e) => !e.jobTitle && !e.company)) {
    warnings.push("Some experience entries have missing job title or company.");
  }
  return { warnings, errors };
}

export async function runResumeWorkflow(
  workflow: WorkflowState,
  options: RunWorkflowOptions = {}
): Promise<WorkflowExecutionResult> {
  const ctx: ExecutionContext = { validationWarnings: [], validationErrors: [] };
  const input = getInitialInput(workflow);
  if (!input) throw new Error("Workflow has no Initial Input node or it has no data.");
  if (!input.jobTitle || !input.companyName || !input.jobDescription) {
    throw new Error("Initial Input: job title, company name, and job description are required.");
  }

  const order = topologicalOrder(workflow);
  const nodeMap = new Map(workflow.nodes.map((n) => [n.id, n]));
  const report = options.onNodeStatus;

  for (const node of order) {
    report?.(node.id, "running");
    try {
      switch (node.type) {
      case "initialInput":
        ctx.workflowInput = input;
        break;

      case "resumeSelection": {
        const selectionData = nodeMap.get(node.id)?.data as Record<string, unknown> | undefined;
        const sheetRowRaw =
          selectionData?.sheetRowIndex ?? selectionData?.resumeId;
        const sheetRowIndex =
          sheetRowRaw != null && String(sheetRowRaw).trim() !== ""
            ? Number(sheetRowRaw)
            : NaN;

        if (!Number.isNaN(sheetRowIndex) && sheetRowIndex >= 1) {
          const res = await fetch(
            `/api/resume-db?id=${sheetRowIndex}&parse=true`,
          );
          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(
              err.error ||
                "Failed to load resume from Resume DB.",
            );
          }
          const data = await res.json();
          const r = data.resume;
          if (!r?.content || !r?.structure) {
            throw new Error(
              "Could not parse resume from resume_url. Check the Google Drive link and sharing.",
            );
          }
          ctx.resume = { content: r.content, structure: r.structure };
        } else if (options.resumeFile) {
          const formData = new FormData();
          formData.append("file", options.resumeFile);
          const res = await fetch("/api/resume-parse-structure", { method: "POST", body: formData });
          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || "Failed to parse resume structure.");
          }
          const { content, structure } = await res.json();
          ctx.resume = { content, structure };
        } else {
          throw new Error(
            "Resume Selection: choose a sheet row from Resume DB, or upload a file when running the workflow."
          );
        }
        break;
      }

      case "jdParsing": {
        const jdDataNode = nodeMap.get(node.id)?.data as Record<string, unknown> | undefined;
        const model = jdDataNode?.model as string | undefined;
        const rawJd = ctx.workflowInput?.jobDescription ?? "";
        if (!rawJd.trim()) {
          ctx.normalizedJd = normalizeJd("");
          break;
        }
        const res = await fetch("/api/jd-parse", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jobDescription: rawJd,
            ...(options.openaiApiKey?.trim() && { openaiApiKey: options.openaiApiKey.trim() }),
            ...(model?.trim() && { model: model.trim() }),
          }),
        });
        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}));
          throw new Error((errBody as { error?: string }).error ?? res.statusText);
        }
        ctx.normalizedJd = (await res.json()) as NormalizedJobDescription;
        break;
      }

      case "tailorAi": {
        if (!ctx.resume) {
          throw new Error("Tailor AI requires a resume from Resume Selection (ResumeDB or uploaded file).");
        }
        const tailorDataNode = nodeMap.get(node.id)?.data as Record<string, unknown> | undefined;
        const model = tailorDataNode?.model as string | undefined;
        const openaiApiKey = options.openaiApiKey;

        let tailorData: {
          tailoredText: string;
          tailoredContent: ResumeContent;
          structure: ResumeStructure;
          formatMetadata?: unknown;
        };

        const useResumeFromDb = ctx.resume != null && !options.resumeFile;
        if (useResumeFromDb) {
          const jsonRes = await fetch("/api/resume-tailor-from-json", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              content: ctx.resume.content,
              structure: ctx.resume.structure,
              jobTitle: input.jobTitle,
              jobDescription: input.jobDescription,
              ...(openaiApiKey?.trim() && { openaiApiKey: openaiApiKey.trim() }),
              ...(model?.trim() && { model: model.trim() }),
            }),
          });
          if (!jsonRes.ok) {
            const err = await jsonRes.json().catch(() => ({}));
            throw new Error(err.error || "Tailor AI failed.");
          }
          tailorData = await jsonRes.json();
        } else {
          if (!options.resumeFile) throw new Error("Tailor AI requires the resume file from Resume Selection.");
          const formData = new FormData();
          formData.append("file", options.resumeFile);
          formData.append("jobTitle", input.jobTitle);
          formData.append("jobDescription", input.jobDescription);
          if (openaiApiKey?.trim()) formData.append("openaiApiKey", openaiApiKey.trim());
          if (model?.trim()) formData.append("model", model.trim());
          const tailorRes = await fetch("/api/resume-tailor-with-structure", {
            method: "POST",
            body: formData,
          });
          if (!tailorRes.ok) {
            const err = await tailorRes.json().catch(() => ({}));
            throw new Error(err.error || "Tailor AI failed.");
          }
          tailorData = await tailorRes.json();
        }
        const atsRes = await fetch("/api/ats-check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jobTitle: input.jobTitle,
            jobDescription: input.jobDescription,
            tailoredResumeText: tailorData.tailoredText,
          }),
        });
        let atsAnalysis: AtsAnalysis = {
          score: 0,
          matchedKeywords: [],
          missingKeywords: [],
        };
        if (atsRes.ok) {
          const atsData = await atsRes.json();
          atsAnalysis = {
            score: atsData.ats_score ?? 0,
            matchedKeywords: atsData.matched_keywords ?? [],
            missingKeywords: atsData.missing_keywords ?? [],
            weakKeywords: atsData.weak_keywords,
            improvementNotes: atsData.recommendations,
          };
        }
        ctx.tailorOutput = {
          atsAnalysis,
          updatedResume: tailorData.tailoredContent,
        };
        ctx.tailoredStructure = tailorData.structure;
        ctx.formatMetadata = tailorData.formatMetadata as ExecutionContext["formatMetadata"];
        break;
      }

      case "resumeValidation": {
        const content = ctx.tailorOutput?.updatedResume;
        if (!content) throw new Error("Resume Validation: no tailored resume from previous step.");
        const { warnings, errors } = validateResumeContent(content);
        ctx.validationWarnings = warnings;
        ctx.validationErrors = errors;
        ctx.validatedResume = content;
        if (errors.length > 0) {
          throw new Error(`Resume Validation failed: ${errors.join(" ")}`);
        }
        break;
      }

      case "templateSelection": {
        const templateNode = nodeMap.get(node.id);
        const data = (templateNode?.data as Record<string, unknown>) ?? {};
        ctx.templateId = (data.templateId as TemplateId) ?? ctx.workflowInput?.templateId ?? "modern";
        break;
      }

      case "resumeToTemplateMapping":
        ctx.templateViewModel = ctx.validatedResume as unknown as TemplateViewModel;
        break;

      case "pdfBuild": {
        if (!ctx.validatedResume) throw new Error("PDF Build: no validated resume.");
        const structure = ctx.tailoredStructure ?? ctx.resume?.structure;
        if (!structure) throw new Error("PDF Build: resume structure is required.");
        const genRes = await fetch("/api/resume-generate-files", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tailoredContent: ctx.validatedResume,
            structure,
            formatMetadata: ctx.formatMetadata,
          }),
        });
        if (!genRes.ok) {
          const err = await genRes.json().catch(() => ({}));
          throw new Error(err.error || "PDF Build failed.");
        }
        const genData = await genRes.json();
        const files = genData.files ?? {};
        ctx.pdfResult = {
          pdfDataUrl: files.pdf?.downloadUrl,
          pdfFileName: files.pdf?.fileName,
          docxDataUrl: files.docx?.downloadUrl,
          docxFileName: files.docx?.fileName,
        };
        break;
      }

      case "download":
        // No-op; result is built below
        break;

      default:
        break;
    }
      report?.(node.id, "success");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      report?.(node.id, "error", message);
      throw err;
    }
  }

  const result: WorkflowExecutionResult = {
    pdf: ctx.pdfResult,
    updatedResume: ctx.validatedResume ?? ctx.tailorOutput?.updatedResume,
    atsAnalysis: ctx.tailorOutput?.atsAnalysis,
    validationWarnings: ctx.validationWarnings.length ? ctx.validationWarnings : undefined,
    validationErrors: ctx.validationErrors.length ? ctx.validationErrors : undefined,
  };
  return result;
}
