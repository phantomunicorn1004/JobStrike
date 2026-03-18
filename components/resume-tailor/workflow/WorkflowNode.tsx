"use client";

import React, { useCallback, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { WorkflowNode } from "./types";
import { getNodeDefinition } from "./nodeRegistry";
import { GripVertical, Loader2, CheckCircle2, XCircle } from "lucide-react";
import type { NodeExecutionStatus } from "./execution";

interface WorkflowNodeProps {
  node: WorkflowNode;
  isSelected?: boolean;
  onPositionChange: (id: string, position: { x: number; y: number }) => void;
  onSelect?: (id: string) => void;
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** Canvas zoom (scale) so drag delta is correct in workflow space */
  zoom?: number;
  /** Execution status (n8n-style) */
  executionStatus?: NodeExecutionStatus;
  executionError?: string;
}

const NODE_WIDTH = 120;
const NODE_HEIGHT = 70;
const HANDLE_SIZE = 15;

export function WorkflowNode({ 
  node,
  isSelected,
  onPositionChange,
  onSelect,
  containerRef,
  zoom = 1,
  executionStatus = "idle",
  executionError,
}: WorkflowNodeProps) {
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, nodeX: 0, nodeY: 0 });

  const def = getNodeDefinition(node.type);
  const Icon = def.icon;
  const typeLabel = def.label;
  const statusDotClass =
    executionStatus === "running"
      ? "bg-primary"
      : executionStatus === "success"
      ? "bg-green-500"
      : executionStatus === "error"
      ? "bg-destructive"
      : "bg-muted-foreground/40";

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if ((e.target as HTMLElement).closest("[data-handle]")) return;
      e.preventDefault();
      onSelect?.(node.id);
      setIsDragging(true);
      dragStart.current = {
        x: e.clientX,
        y: e.clientY,
        nodeX: node.position.x,
        nodeY: node.position.y,
      };
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    },
    [node.id, node.position.x, node.position.y, onSelect]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isDragging) return;
      const dx = (e.clientX - dragStart.current.x) / zoom;
      const dy = (e.clientY - dragStart.current.y) / zoom;
      onPositionChange(node.id, {
        x: dragStart.current.nodeX + dx,
        y: dragStart.current.nodeY + dy,
      });
    },
    [isDragging, node.id, onPositionChange, zoom]
  );

  const handlePointerUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  return (
    <div
      data-workflow-node
      className="absolute cursor-grab active:cursor-grabbing select-none"
      style={{
        left: node.position.x,
        top: node.position.y,
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
    >
      {/* External label above node: centered on node, full text visible */}
      <div className="absolute -top-6 left-1/2 -translate-x-1/2 pointer-events-none select-none flex items-center justify-center gap-2">
        <span className={`h-2 w-2 shrink-0 rounded-full ${statusDotClass}`} />
        <span className="text-xs text-foreground/80 font-medium whitespace-nowrap">
          {node.label || typeLabel}
        </span>
      </div>
      {/* Input handle (left center) */}
      <div
        data-handle
        className="absolute left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 h-3 w-3 rounded-full border-2 border-background bg-muted-foreground/60 shadow cursor-crosshair z-10 hover:bg-primary hover:scale-110 transition"
        style={{ left: -HANDLE_SIZE / 2, top: NODE_HEIGHT / 2 }}
        title="Input"
      />

      <div
        className={cn(
          "h-full rounded-xl border-2 bg-card/90 backdrop-blur-sm shadow-sm transition-all flex items-center gap-3 px-3 py-2",
          def.border,
          isSelected
            ? "ring-2 ring-primary ring-offset-2 shadow-md"
            : "hover:shadow-md hover:-translate-y-[1px]",
          executionStatus === "running" && "ring-2 ring-primary/50 ring-offset-1",
          executionStatus === "success" && "ring-2 ring-green-500/50 ring-offset-1",
          executionStatus === "error" && "ring-2 ring-destructive/50 ring-offset-1"
        )}
      >
        <div
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl relative",
            def.iconBg
          )}
        >
          {executionStatus === "running" ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <Icon className="h-5 w-5" />
          )}
        </div>
        {/* Minimal right-side status icons (no text inside card) */}
        <div className="ml-auto flex items-center gap-1 shrink-0 pr-1">
          {executionStatus === "success" && (
            <span title="Completed" className="inline-flex">
              <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
            </span>
          )}
          {executionStatus === "error" && (
            <span title={executionError ?? "Error"} className="inline-flex">
              <XCircle className="h-4 w-4 text-destructive" />
            </span>
          )}
        </div>
        <GripVertical className="h-4 w-4 text-muted-foreground/40 shrink-0" />
      </div>

      {/* Output handle (right center) */}
      <div
        data-handle
        className="absolute right-0 top-1/2 translate-x-1/2 -translate-y-1/2 h-3 w-3 rounded-full border-2 border-background bg-muted-foreground/60 shadow cursor-crosshair z-10 hover:bg-primary hover:scale-110 transition"
        style={{ right: -HANDLE_SIZE / 2, top: NODE_HEIGHT / 2 }}
        title="Output"
      />
    </div>
  );
}

export const NODE_DIMENSIONS = { width: NODE_WIDTH, height: NODE_HEIGHT };
export const NODE_HANDLE_OFFSET = { x: NODE_WIDTH, y: NODE_HEIGHT / 2 };
