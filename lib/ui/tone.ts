/** One status language app-wide: progress=working, attention=waiting for you, danger=failed, success=sent/offer, idle=neutral. */
export type Tone = "progress" | "attention" | "danger" | "success" | "idle";

export const TONE_PILL: Record<Tone, string> = {
  progress: "bg-primary/10 text-primary",
  attention: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  danger: "bg-rose-500/15 text-rose-700 dark:text-rose-400",
  success: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  idle: "bg-muted text-muted-foreground",
};

export const TONE_DOT: Record<Tone, string> = {
  progress: "bg-primary",
  attention: "bg-amber-500",
  danger: "bg-rose-500",
  success: "bg-emerald-500",
  idle: "bg-muted-foreground/40",
};

export const TONE_TEXT: Record<Tone, string> = {
  progress: "text-primary",
  attention: "text-amber-700 dark:text-amber-400",
  danger: "text-rose-700 dark:text-rose-400",
  success: "text-emerald-700 dark:text-emerald-400",
  idle: "text-muted-foreground",
};
