"use client";

import React from "react";
import type { WorkflowEdge as WorkflowEdgeType } from "./types";
import type { WorkflowNode } from "./types";
import { NODE_DIMENSIONS } from "./WorkflowNode";

interface WorkflowEdgesProps {
  edges: WorkflowEdgeType[];
  nodes: WorkflowNode[];
}

function getNodeHandlePositions(
  node: WorkflowNode,
  side: "source" | "target"
): { x: number; y: number } {
  const { width, height } = NODE_DIMENSIONS;
  const x = node.position.x + (side === "source" ? width : 0);
  const y = node.position.y + height / 2;
  return { x, y };
}

export function WorkflowEdges({ edges, nodes }: WorkflowEdgesProps) {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  return (
    <svg
      className="absolute inset-0 pointer-events-none overflow-visible"
      style={{ width: "100%", height: "100%" }}
    >
      <defs>
        <marker
          id="arrowhead"
          markerWidth="10"
          markerHeight="7"
          refX="9"
          refY="3.5"
          orient="auto"
        >
          <polygon
            points="0 0, 10 3.5, 0 7"
            className="fill-muted-foreground"
          />
        </marker>
      </defs>
      <g>
        {edges.map((edge) => {
          const sourceNode = nodeMap.get(edge.sourceId);
          const targetNode = nodeMap.get(edge.targetId);
          if (!sourceNode || !targetNode) return null;

          const start = getNodeHandlePositions(sourceNode, "source");
          const end = getNodeHandlePositions(targetNode, "target");

          const dx = end.x - start.x;
          const cpx = start.x + Math.max(80, Math.abs(dx) * 0.5);
          const cpy = start.y;
          const cpx2 = end.x - Math.max(80, Math.abs(dx) * 0.5);
          const cpy2 = end.y;

          const pathD = `M ${start.x} ${start.y} C ${cpx} ${cpy}, ${cpx2} ${cpy2}, ${end.x} ${end.y}`;

          return (
            <path
              key={edge.id}
              d={pathD}
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              className="text-muted-foreground/70"
              markerEnd="url(#arrowhead)"
            />
          );
        })}
      </g>
    </svg>
  );
}
