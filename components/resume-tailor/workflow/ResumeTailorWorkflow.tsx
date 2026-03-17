"use client";

import React, { useRef, useState } from "react";
import { WorkflowCanvas } from "./WorkflowCanvas";
import { SAMPLE_WORKFLOW } from "./sampleWorkflow";
import { NodeSettingsPanel } from "./NodeSettingsPanel";
import { WorkflowResultPanel } from "./WorkflowResultPanel";
import { runResumeWorkflow } from "./execution";
import type { WorkflowState } from "./types";
import type { WorkflowExecutionResult } from "./contracts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Plus, Settings2, Play, PanelRightOpen, Loader2, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export function ResumeTailorWorkflow() {
  const [workflow, setWorkflow] = useState<WorkflowState>(SAMPLE_WORKFLOW);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [showNodePanel, setShowNodePanel] = useState(true);
  const [isRunning, setIsRunning] = useState(false);
  const [executionResult, setExecutionResult] = useState<WorkflowExecutionResult | null>(null);
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selectedNode = selectedNodeId
    ? workflow.nodes.find((n) => n.id === selectedNodeId)
    : null;

  const handleRun = async () => {
    if (!resumeFile) {
      toast.error("Upload a resume file (PDF or DOCX) to run the workflow.");
      return;
    }
    setIsRunning(true);
    setExecutionResult(null);
    try {
      const result = await runResumeWorkflow(workflow, { resumeFile });
      setExecutionResult(result);
      toast.success("Workflow completed.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Workflow failed.";
      toast.error(msg);
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="flex flex-col h-full gap-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.docx"
            className="hidden"
            onChange={(e) => setResumeFile(e.target.files?.[0] ?? null)}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="h-4 w-4 mr-2" />
            {resumeFile ? resumeFile.name : "Upload resume"}
          </Button>
          <Button variant="outline" size="sm" disabled>
            <Plus className="h-4 w-4 mr-2" />
            Add node
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRun}
            disabled={isRunning || !resumeFile}
          >
            {isRunning ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Play className="h-4 w-4 mr-2" />
            )}
            Run workflow
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setShowNodePanel((v) => !v)}
            title={showNodePanel ? "Hide panel" : "Show panel"}
          >
            <PanelRightOpen
              className={cn("h-4 w-4", !showNodePanel && "opacity-50")}
            />
          </Button>
          <Button variant="outline" size="sm">
            <Settings2 className="h-4 w-4 mr-2" />
            Settings
          </Button>
        </div>
      </div>

      <div className="flex gap-4 flex-1 min-h-0">
        <Card className="flex-1 min-w-0 overflow-hidden flex flex-col">
          <CardContent className="p-2 flex-1 min-h-[420px]">
            <WorkflowCanvas
              workflow={workflow}
              onWorkflowChange={setWorkflow}
              selectedNodeId={selectedNodeId}
              onSelectNode={setSelectedNodeId}
            />
          </CardContent>
        </Card>

        {showNodePanel && (
          <Card className="w-80 shrink-0 flex flex-col max-h-[calc(100vh-12rem)] overflow-hidden">
            <CardHeader className="py-3 shrink-0">
              <CardTitle className="text-base">
                {selectedNode ? "Node settings" : "Workflow"}
              </CardTitle>
            </CardHeader>
            <CardContent className="py-2 text-sm overflow-y-auto">
              {selectedNode ? (
                <NodeSettingsPanel
                  node={selectedNode}
                  workflow={workflow}
                  onWorkflowChange={setWorkflow}
                />
              ) : (
                <p className="text-muted-foreground">
                  Select a node to edit its settings, or drag nodes to rearrange
                  the workflow.
                </p>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {executionResult && (
        <WorkflowResultPanel
          result={executionResult}
          onClose={() => setExecutionResult(null)}
        />
      )}
    </div>
  );
}
