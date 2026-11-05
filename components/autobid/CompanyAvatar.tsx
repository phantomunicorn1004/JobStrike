import React from "react";
import { cn } from "@/lib/utils";

export function CompanyAvatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border bg-muted/60 text-sm font-semibold text-muted-foreground",
        className,
      )}
    >
      {(name.trim()[0] || "?").toUpperCase()}
    </span>
  );
}
