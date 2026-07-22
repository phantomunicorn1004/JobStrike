/** Stable per-candidate colors shared across dashboard charts. */
export const CANDIDATE_COLOR_PALETTE = [
  "#6666ff",
  "#22c55e",
  "#f59e0b",
  "#ec4899",
  "#06b6d4",
  "#a78bfa",
  "#f97316",
  "#14b8a6",
  "#eab308",
  "#8b5cf6",
  "#3b82f6",
  "#84cc16",
] as const;

export function colorForCandidateKey(key: string): string {
  let hash = 2166136261;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const index = Math.abs(hash) % CANDIDATE_COLOR_PALETTE.length;
  return CANDIDATE_COLOR_PALETTE[index];
}
