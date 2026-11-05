/**
 * "Saved form answers" on a profile (`profiles.autofill.savedAnswers`): plain
 * text the user can read and edit on the profile page, one "Q:" and one "A:"
 * line per answer. The panel matches each form question against them first.
 */

export type SavedAnswer = { question: string; answer: string };

export const SAVED_ANSWERS_KEY = "savedAnswers";

export function parseSavedAnswers(text: string): SavedAnswer[] {
  const out: SavedAnswer[] = [];
  let question = "";
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.trim();
    const q = /^q\s*[:：]\s*(.*)$/i.exec(line);
    if (q) {
      question = q[1].trim();
      continue;
    }
    const a = /^a\s*[:：]\s*(.*)$/i.exec(line);
    if (a && question) {
      out.push({ question, answer: a[1].trim() });
      question = "";
    }
  }
  return out.filter((entry) => entry.question && entry.answer);
}

export function formatSavedAnswers(entries: SavedAnswer[]): string {
  return entries.map((entry) => `Q: ${entry.question}\nA: ${entry.answer}`).join("\n\n");
}

const key = (question: string) => question.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** New answers replace saved ones for the same question; the rest are kept in order. */
export function mergeSavedAnswers(existing: string, incoming: SavedAnswer[]): string {
  const list = parseSavedAnswers(existing);
  for (const entry of incoming) {
    const question = entry.question.replace(/\s+/g, " ").trim().slice(0, 300);
    const answer = entry.answer.replace(/\s+/g, " ").trim().slice(0, 1000);
    if (!question || !answer) continue;
    const at = list.findIndex((saved) => key(saved.question) === key(question));
    if (at >= 0) list[at] = { question, answer };
    else list.push({ question, answer });
  }
  return formatSavedAnswers(list);
}

const ASHBY_MISSING_RE = /missing entry for required field:\s*(.+?)(?=\s*·|\s*\(auto-fix|$)/gi;
const NOT_FILLED_RE = /required fields? not filled:\s*(.+?)(?:…)?$/i;

/** The required questions a stopped job could not answer, from its report or its stop reason. */
export function missingFieldsOf(bidError: string, bidMeta: Record<string, unknown> | null): string[] {
  const open = bidMeta?.openFields;
  const fromMeta = Array.isArray(open) ? open.map((v) => String(v ?? "").trim()).filter(Boolean) : [];
  const fromAshby = [...String(bidError || "").matchAll(ASHBY_MISSING_RE)].map((m) => m[1].trim());
  const notFilled = NOT_FILLED_RE.exec(String(bidError || "").trim());
  const fromStop = notFilled ? notFilled[1].split(/;\s*/).map((v) => v.trim()) : [];
  const all = [...fromMeta, ...fromAshby, ...(fromMeta.length ? [] : fromStop)];
  return [...new Set(all.filter((v) => v && v.toUpperCase() !== "VERIFY"))].slice(0, 8);
}
