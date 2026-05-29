"use client";
import React from "react";
import { Copy } from "lucide-react";
import { cn } from "@/lib/utils";

export function CopyButton({ value }: { value: string }) {
  const [isCopied, setIsCopied] = React.useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(value);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 1000);
  };

  return (
    <button
      className="ml-2 rounded border border-transparent p-1 text-muted-foreground transition hover:border-border hover:bg-accent hover:text-accent-foreground"
      onClick={handleCopy}
      type="button"
      title="Copy"
      aria-label="Copy"
    >
      <Copy
        size={16}
        className={cn(isCopied && "text-primary")}
      />
    </button>
  );
}
