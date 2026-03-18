"use client";

import React, { useCallback, useRef, useState } from "react";
import { WorkflowNode } from "./WorkflowNode";
import { WorkflowEdges } from "./WorkflowEdges";
import { NODE_DIMENSIONS } from "./WorkflowNode";
import { Button } from "@/components/ui/button";
import { ZoomIn, ZoomOut, Maximize2 } from "lucide-react";
import type { WorkflowState } from "./types";
import type { NodeExecutionStatus } from "./execution";

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 2;
const ZOOM_SENSITIVITY = 0.001;

interface WorkflowCanvasProps {
  workflow: WorkflowState;
  onWorkflowChange: (workflow: WorkflowState) => void;
  selectedNodeId: string | null;
  onSelectNode: (id: string | null) => void;
  /** Per-node execution status (n8n-style) */
  nodeStatus?: Record<string, NodeExecutionStatus>;
  nodeErrors?: Record<string, string>;
}

function getContentBounds(workflow: WorkflowState) {
  if (workflow.nodes.length === 0) return { width: 800, height: 500 };
  let maxX = 0;
  let maxY = 0;
  for (const n of workflow.nodes) {
    maxX = Math.max(maxX, n.position.x + NODE_DIMENSIONS.width);
    maxY = Math.max(maxY, n.position.y + NODE_DIMENSIONS.height);
  }
  return {
    width: Math.max(maxX + 200, 800),
    height: Math.max(maxY + 120, 500),
  };
}

export function WorkflowCanvas({
  workflow,
  onWorkflowChange,
  selectedNodeId,
  onSelectNode,
  nodeStatus = {},
  nodeErrors = {},
}: WorkflowCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(0.8);
  const [pan, setPan] = useState({ x: 20, y: 20 });
  const panStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [spaceKeyHeld, setSpaceKeyHeld] = useState(false);

  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.key === " ") {
        e.preventDefault();
        setSpaceKeyHeld(true);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.key === " ") {
        e.preventDefault();
        setSpaceKeyHeld(false);
        setIsPanning(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  const contentSize = getContentBounds(workflow);

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

  const handleWheel = useCallback(
    (e: WheelEvent) => {
      const container = containerRef.current;
      if (!container || !container.contains(e.target as Node)) return;
      e.preventDefault();
      const rect = container.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const contentX = (mouseX - pan.x) / zoom;
      const contentY = (mouseY - pan.y) / zoom;
      const delta = -e.deltaY * ZOOM_SENSITIVITY;
      const factor = 1 + Math.abs(delta) * (delta > 0 ? 1 : -1);
      const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * factor));
      setZoom(newZoom);
      setPan({
        x: mouseX - contentX * newZoom,
        y: mouseY - contentY * newZoom,
      });
    },
    [zoom, pan]
  );

  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => container.removeEventListener("wheel", handleWheel);
  }, [handleWheel]);

  const handlePanPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("[data-workflow-node]")) return;
    e.preventDefault();
    setIsPanning(true);
    panStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  }, [pan.x, pan.y]);

  const handlePanPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isPanning) return;
      setPan({
        x: panStart.current.panX + (e.clientX - panStart.current.x),
        y: panStart.current.panY + (e.clientY - panStart.current.y),
      });
    },
    [isPanning]
  );

  const handlePanPointerUp = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    setIsPanning(false);
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
  }, []);

  const handleSpaceOverlayPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0 || !spaceKeyHeld) return;
      e.preventDefault();
      e.stopPropagation();
      setIsPanning(true);
      panStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    },
    [spaceKeyHeld, pan.x, pan.y]
  );

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full min-h-[420px] rounded-lg border border-border bg-muted/30 overflow-hidden touch-none"
      style={{
        backgroundImage: `radial-gradient(circle, var(--muted-foreground) 1px, transparent 1px)`,
        backgroundSize: "16px 16px",
      }}
    >
      <div
        className="absolute overflow-visible"
        style={{
          left: 0,
          top: 0,
          width: contentSize.width,
          height: contentSize.height,
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: "0 0",
        }}
      >
        <div
          className="absolute cursor-grab active:cursor-grabbing"
          style={{
            left: 0,
            top: 0,
            width: contentSize.width,
            height: contentSize.height,
            zIndex: 0,
          }}
          onPointerDown={handlePanPointerDown}
          onPointerMove={handlePanPointerMove}
          onPointerUp={handlePanPointerUp}
          onPointerLeave={handlePanPointerUp}
          onClick={handleCanvasClick}
        />
        <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 1 }}>
          <WorkflowEdges edges={workflow.edges} nodes={workflow.nodes} />
        </div>
        <div className="absolute inset-0" style={{ zIndex: 2 }}>
          {workflow.nodes.map((node) => (
            <WorkflowNode
              key={node.id}
              node={node}
              isSelected={selectedNodeId === node.id}
              onPositionChange={handlePositionChange}
              onSelect={onSelectNode}
              containerRef={containerRef}
              zoom={zoom}
              executionStatus={nodeStatus[node.id]}
              executionError={nodeErrors[node.id]}
            />
          ))}
        </div>
      </div>
      <div className="absolute bottom-2 right-2 z-20 flex items-center gap-1 rounded-md border border-border bg-background/95 p-1 shadow-sm">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => {
            const container = containerRef.current;
            if (!container) return;
            const rect = container.getBoundingClientRect();
            const cx = rect.width / 2;
            const cy = rect.height / 2;
            const contentX = (cx - pan.x) / zoom;
            const contentY = (cy - pan.y) / zoom;
            const newZoom = Math.min(MAX_ZOOM, zoom * 1.2);
            setZoom(newZoom);
            setPan({ x: cx - contentX * newZoom, y: cy - contentY * newZoom });
          }}
        >
          <ZoomIn className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => {
            const container = containerRef.current;
            if (!container) return;
            const rect = container.getBoundingClientRect();
            const cx = rect.width / 2;
            const cy = rect.height / 2;
            const contentX = (cx - pan.x) / zoom;
            const contentY = (cy - pan.y) / zoom;
            const newZoom = Math.max(MIN_ZOOM, zoom / 1.2);
            setZoom(newZoom);
            setPan({ x: cx - contentX * newZoom, y: cy - contentY * newZoom });
          }}
        >
          <ZoomOut className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => {
            setZoom(0.8);
            setPan({ x: 20, y: 20 });
          }}
        >
          <Maximize2 className="h-4 w-4" />
        </Button>
        <span className="text-muted-foreground px-1 text-xs tabular-nums">
          {Math.round(zoom * 100)}%
        </span>
      </div>
      {/* Space+drag overlay: when Space is held, drag anywhere to pan */}
      <div
        className="absolute inset-0 z-10 cursor-grab active:cursor-grabbing"
        style={{
          pointerEvents: spaceKeyHeld ? "auto" : "none",
        }}
        onPointerDown={handleSpaceOverlayPointerDown}
        onPointerMove={handlePanPointerMove}
        onPointerUp={handlePanPointerUp}
        onPointerLeave={handlePanPointerUp}
        title={spaceKeyHeld ? "Drag to pan workspace" : "Hold Space + drag to pan"}
      />
      {spaceKeyHeld && (
        <div className="absolute left-2 top-2 z-20 rounded bg-muted/90 px-2 py-1 text-xs text-muted-foreground">
          Hold Space · Drag to pan
        </div>
      )}
    </div>
  );
}
