"use client";
import React from "react";
import { Copy } from "lucide-react";

export function CopyButton({ value }: { value: string }) {
  const [isCopied, setIsCopied] = React.useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(value);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 1000);
  };

  return (
    <button
      className="ml-2 p-1 rounded hover:bg-blue-100 border border-transparent hover:border-blue-300 text-gray-700 transition"
      onClick={handleCopy}
      type="button"
      title="Copy"
      aria-label="Copy"
    >
      <Copy
        size={16}
        className={isCopied ? "text-blue-600" : "text-gray-400"}
      />
    </button>
  );
}
