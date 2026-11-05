import React from "react";
import { Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { colorForCandidateKey } from "@/lib/dashboard/candidate-colors";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

/** A candidate's identity: the same colour as in the dashboard charts. Null id = all candidates. */
export function CandidateAvatar({
  profileId,
  name,
  className,
}: {
  profileId: number | null;
  name: string;
  className?: string;
}) {
  if (profileId === null) {
    return (
      <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground", className)}>
        <Users className="h-3.5 w-3.5" />
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      style={{ backgroundColor: colorForCandidateKey(`profile-${profileId}`) }}
      className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white", className)}
    >
      {initials(name)}
    </span>
  );
}
