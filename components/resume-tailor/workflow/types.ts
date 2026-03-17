/** Legacy generic types (kept for backward compatibility). */
export type LegacyNodeType =
  | "trigger"
  | "input"
  | "ai"
  | "transform"
  | "output";

/** Resume workflow node types. */
export type ResumeNodeType =
  | "initialInput"
  | "resumeSelection"
  | "jdParsing"
  | "tailorAi"
  | "resumeValidation"
  | "templateSelection"
  | "resumeToTemplateMapping"
  | "pdfBuild"
  | "download";

export type WorkflowNodeType = LegacyNodeType | ResumeNodeType;

export interface WorkflowNode {
  id: string;
  type: WorkflowNodeType;
  label: string;
  position: { x: number; y: number };
  description?: string;
  /** Node-type-specific settings (serialized for save/load). */
  data?: Record<string, unknown>;
}

export interface WorkflowEdge {
  id: string;
  sourceId: string;
  targetId: string;
}

export interface WorkflowState {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}
