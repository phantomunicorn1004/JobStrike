"use client";

import React, { useCallback, useRef, useState } from "react";
import { WorkflowNode } from "./WorkflowNode";
import { WorkflowEdges } from "./WorkflowEdges";
import type { WorkflowState } from "./types";

interface WorkflowCanvasProps {
  workflow: WorkflowState;
  onWorkflowChange: (workflow: WorkflowState) => void;
  selectedNodeId: string | null;
  onSelectNode: (id: string | null) => void;
}

export function WorkflowCanvas({
  workflow,
  onWorkflowChange,
  selectedNodeId,
  onSelectNode,
}: WorkflowCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const handlePositionChange = useCallback(
    (id: string, position: { x: number; y: number }) => {
      onWorkflowChange({
        ...workflow,
        nodes: workflow.nodes.map((n) =>
          n.id === id ? { ...n, position } : n
        ),
      });
    },
    [workflow, onWorkflowChange]
  );

  const handleCanvasClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onSelectNode(null);
    },
    [onSelectNode]
  );

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full min-h-[420px] rounded-lg border border-border bg-muted/30 overflow-hidden"
      style={{
        backgroundImage: `radial-gradient(circle, var(--muted-foreground) 1px, transparent 1px)`,
        backgroundSize: "16px 16px",
      }}
    >
      <div
        className="absolute inset-0"
        onClick={handleCanvasClick}
        onPointerDown={(e) => e.target === e.currentTarget && onSelectNode(null)}
      >
        <WorkflowEdges edges={workflow.edges} nodes={workflow.nodes} />
        {workflow.nodes.map((node) => (
          <WorkflowNode
            key={node.id}
            node={node}
            isSelected={selectedNodeId === node.id}
            onPositionChange={handlePositionChange}
            onSelect={onSelectNode}
            containerRef={containerRef}
          />
        ))}
      </div>
    </div>
  );
}
