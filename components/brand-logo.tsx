"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";

type BrandLogoProps = {
  href?: string;
  className?: string;
  /** Compact mark-only (sidebar icon-collapsed). */
  markClassName?: string;
  /** Expanded wordmark row. */
  wordmarkClassName?: string;
};

/**
 * JobStrike brand: transparent mark + CSS wordmark.
 * Avoids clipped PNG wordmarks in the narrow/collapsed sidebar.
 */
export function BrandLogo({
  href = "/dashboard",
  className,
  markClassName,
  wordmarkClassName,
}: BrandLogoProps) {
  return (
    <Link
      href={href}
      aria-label="JobStrike"
      className={cn(
        "flex min-w-0 items-center gap-2.5",
        "group-data-[collapsible=icon]:justify-center",
        className,
      )}
    >
      <img
        src="/logo-mark.png"
        alt=""
        aria-hidden="true"
        className={cn(
          "h-9 w-9 shrink-0 object-contain",
          "group-data-[collapsible=icon]:h-8 group-data-[collapsible=icon]:w-8",
          markClassName,
        )}
      />
      <span
        className={cn(
          "truncate text-[1.05rem] font-bold leading-none tracking-tight",
          "group-data-[collapsible=icon]:hidden",
          wordmarkClassName,
        )}
      >
        <span className="text-sidebar-foreground">Job</span>
        <span className="text-primary">Strike</span>
      </span>
    </Link>
  );
}
