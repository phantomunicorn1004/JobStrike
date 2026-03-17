"use client";

import React, { useCallback, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { WorkflowNode } from "./types";
import { getNodeDefinition } from "./nodeRegistry";
import { GripVertical } from "lucide-react";

interface WorkflowNodeProps {
  node: WorkflowNode;
  isSelected?: boolean;
  onPositionChange: (id: string, position: { x: number; y: number }) => void;
  onSelect?: (id: string) => void;
  containerRef: React.RefObject<HTMLDivElement | null>;
}

const NODE_WIDTH = 200;
const NODE_HEIGHT = 72;
const HANDLE_SIZE = 12;

export function WorkflowNode({
  node,
  isSelected,
  onPositionChange,
  onSelect,
  containerRef,
}: WorkflowNodeProps) {
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, nodeX: 0, nodeY: 0 });

  const def = getNodeDefinition(node.type);
  const Icon = def.icon;
  const typeLabel = def.label;

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
      const dx = e.clientX - dragStart.current.x;
      const dy = e.clientY - dragStart.current.y;
      onPositionChange(node.id, {
        x: dragStart.current.nodeX + dx,
        y: dragStart.current.nodeY + dy,
      });
    },
    [isDragging, node.id, onPositionChange]
  );

  const handlePointerUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  return (
    <div
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
      {/* Input handle (left center) */}
      <div
        data-handle
        className="absolute left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 w-3 h-3 rounded-full border-2 border-background bg-muted-foreground/60 shadow cursor-crosshair z-10 hover:bg-primary"
        style={{ left: -HANDLE_SIZE / 2, top: NODE_HEIGHT / 2 }}
        title="Input"
      />

      <div
        className={cn(
          "h-full rounded-lg border-2 bg-card shadow-md transition-shadow flex items-center gap-3 px-3 py-2 pl-5",
          def.border,
          isSelected && "ring-2 ring-primary ring-offset-2"
        )}
      >
        <div
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
            def.iconBg
          )}
        >
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm truncate">{node.label}</span>
            <span
              className={cn(
                "text-[10px] font-medium px-1.5 py-0.5 rounded",
                def.badge
              )}
            >
              {typeLabel}
            </span>
          </div>
          {node.description && (
            <p className="text-xs text-muted-foreground truncate">
              {node.description}
            </p>
          )}
        </div>
        <GripVertical className="h-4 w-4 text-muted-foreground/50 shrink-0" />
      </div>

      {/* Output handle (right center) */}
      <div
        data-handle
        className="absolute right-0 top-1/2 translate-x-1/2 -translate-y-1/2 w-3 h-3 rounded-full border-2 border-background bg-muted-foreground/60 shadow cursor-crosshair z-10 hover:bg-primary"
        style={{ right: -HANDLE_SIZE / 2, top: NODE_HEIGHT / 2 }}
        title="Output"
      />
    </div>
  );
}

export const NODE_DIMENSIONS = { width: NODE_WIDTH, height: NODE_HEIGHT };
export const NODE_HANDLE_OFFSET = { x: NODE_WIDTH, y: NODE_HEIGHT / 2 };
