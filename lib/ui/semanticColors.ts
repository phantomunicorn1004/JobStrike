/** Theme-aware semantic colors for status, scores, and feedback panels. */

export const statusDot = {
  success: "bg-emerald-500 dark:bg-emerald-400",
  fail: "bg-destructive",
  pending: "bg-amber-500 dark:bg-amber-400",
} as const;

export function scoreTextClass(score: number): string {
  if (score >= 80) return "text-emerald-600 dark:text-emerald-400";
  if (score >= 60) return "text-amber-600 dark:text-amber-400";
  return "text-destructive";
}

export function scoreBgClass(score: number): string {
  if (score >= 80) return "bg-emerald-500 dark:bg-emerald-400";
  if (score >= 60) return "bg-amber-500 dark:bg-amber-400";
  return "bg-destructive";
}

export const successBorderClass = "border-emerald-500/50 dark:border-emerald-400/50";
export const successIconClass = "text-emerald-600 dark:text-emerald-400";
export const successTextClass = "text-emerald-700 dark:text-emerald-300";
export const successTextStrongClass = "text-emerald-800 dark:text-emerald-200";
export const successPanelClass =
  "bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800";

export const warningIconClass = "text-amber-600 dark:text-amber-400";
export const warningPanelClass =
  "bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800";
export const warningTextClass = "text-amber-900 dark:text-amber-200";

export const infoPanelClass =
  "bg-primary/5 dark:bg-primary/10 border border-primary/20 dark:border-primary/30";
export const infoTextClass = "text-foreground/90";

export const matchedBadgeClass = "bg-emerald-600 dark:bg-emerald-500 text-white";
export const missingBadgeClass =
  "border-amber-500/70 dark:border-amber-400/70 text-amber-800 dark:text-amber-300";
