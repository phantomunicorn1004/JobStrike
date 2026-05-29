"use client";

import React, { useRef } from "react";
import { TableHead } from "@/components/ui/table";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ResumeDBColumnId } from "./useResizableColumns";

type SortDir = "asc" | "desc";

type BaseProps = {
  columnId: ResumeDBColumnId;
  width: number;
  onResize: (id: ResumeDBColumnId, width: number) => void;
  className?: string;
  align?: "left" | "center" | "right";
  children: React.ReactNode;
};

function ResizeHandle({
  onResizeStart,
}: {
  onResizeStart: (clientX: number) => void;
}) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize column"
      onMouseDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onResizeStart(e.clientX);
      }}
      className={cn(
        "absolute right-0 top-0 z-10 h-full w-2 translate-x-1/2 cursor-col-resize",
        "touch-none select-none",
        "after:absolute after:inset-y-2 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-border/80",
        "hover:after:bg-primary/60 active:after:bg-primary",
      )}
    />
  );
}

function useColumnResize(
  columnId: ResumeDBColumnId,
  width: number,
  onResize: (id: ResumeDBColumnId, width: number) => void,
) {
  const startX = useRef(0);
  const startWidth = useRef(width);

  const beginResize = (clientX: number) => {
    startX.current = clientX;
    startWidth.current = width;

    const onMove = (event: MouseEvent) => {
      const delta = event.clientX - startX.current;
      onResize(columnId, startWidth.current + delta);
    };

    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  return beginResize;
}

export function ResizableTableHead({
  columnId,
  width,
  onResize,
  className,
  align = "left",
  children,
}: BaseProps) {
  const beginResize = useColumnResize(columnId, width, onResize);

  return (
    <TableHead
      style={{ width, minWidth: width, maxWidth: width }}
      className={cn(
        "relative border-r border-border/50 px-2 py-2.5 last:border-r-0",
        align === "center" && "text-center",
        align === "right" && "text-right",
        className,
      )}
    >
      <div
        className={cn(
          typeof children === "string"
            ? "truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground"
            : "flex w-full min-w-0",
          align === "center" && (typeof children === "string" ? "mx-auto w-fit" : "justify-center"),
          align === "right" && (typeof children === "string" ? "ml-auto w-fit" : "justify-end"),
        )}
      >
        {children}
      </div>
      <ResizeHandle onResizeStart={beginResize} />
    </TableHead>
  );
}

export function ResizableSortableHead({
  columnId,
  width,
  onResize,
  label,
  active,
  direction,
  onSort,
  className,
  align = "left",
}: Omit<BaseProps, "children"> & {
  label: string;
  active: boolean;
  direction: SortDir;
  onSort: () => void;
}) {
  const Icon = active ? (direction === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
  const beginResize = useColumnResize(columnId, width, onResize);

  return (
    <TableHead
      style={{ width, minWidth: width, maxWidth: width }}
      className={cn(
        "relative border-r border-border/50 px-2 py-2.5 last:border-r-0",
        align === "center" && "text-center",
        align === "right" && "text-right",
        className,
      )}
    >
      <button
        type="button"
        onClick={onSort}
        className={cn(
          "inline-flex max-w-full items-center gap-1 truncate text-xs font-semibold uppercase tracking-wide transition-colors",
          active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
          align === "center" && "mx-auto",
          align === "right" && "ml-auto",
        )}
      >
        <span className="truncate">{label}</span>
        <Icon className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden="true" />
      </button>
      <ResizeHandle onResizeStart={beginResize} />
    </TableHead>
  );
}

export function ResizableTableCell({
  width,
  className,
  align = "left",
  children,
}: {
  width: number;
  className?: string;
  align?: "left" | "center" | "right";
  children: React.ReactNode;
}) {
  return (
    <td
      style={{ width, minWidth: width, maxWidth: width }}
      className={cn(
        "border-r border-border/40 px-2 py-2 align-middle text-sm last:border-r-0",
        align === "center" && "text-center",
        align === "right" && "text-right",
        className,
      )}
    >
      {children}
    </td>
  );
}
