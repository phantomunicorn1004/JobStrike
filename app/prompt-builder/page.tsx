import React, { Suspense } from "react";
import { PromptBuilderPageClient } from "@/components/prompt-builder/PromptBuilderPageClient";

export const dynamic = "force-dynamic";

export default function PromptBuilderPage() {
  return (
    <Suspense fallback={<div className="p-6">Loading...</div>}>
      <PromptBuilderPageClient />
    </Suspense>
  );
}
