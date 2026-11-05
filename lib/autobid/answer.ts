import "server-only";

import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { retryBids } from "@/lib/autobid/claim";
import { mergeSavedAnswers, SAVED_ANSWERS_KEY, type SavedAnswer } from "@/lib/autobid/saved-answers";

/**
 * Saves the user's answers for a stopped job on its candidate's profile, so
 * every later form asking the same question is filled, then retries the job.
 * A job where Submit was pressed keeps its state: only the answers are saved.
 */
export async function answerAndRetry(
  userId: string,
  id: number,
  answers: SavedAnswer[],
): Promise<{ saved: number; retried: boolean }> {
  const supabase = getSupabaseAdminClient();
  const { data: job, error } = await supabase
    .from("resume_db_applications")
    .select("profile_id")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const profileId = Number((job as { profile_id: number | null } | null)?.profile_id);
  if (!profileId) throw new Error("This job has no candidate profile to save answers on.");

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("autofill")
    .eq("id", profileId)
    .eq("user_id", userId)
    .maybeSingle();
  if (profileError) throw new Error(profileError.message);
  if (!profile) throw new Error("The candidate profile was not found.");

  const autofill = ((profile as { autofill: Record<string, string> | null }).autofill ?? {}) as Record<string, string>;
  const merged = mergeSavedAnswers(autofill[SAVED_ANSWERS_KEY] ?? "", answers);
  const { error: saveError } = await supabase
    .from("profiles")
    .update({ autofill: { ...autofill, [SAVED_ANSWERS_KEY]: merged }, updated_at: new Date().toISOString() } as never)
    .eq("id", profileId)
    .eq("user_id", userId);
  if (saveError) throw new Error(saveError.message);

  const retried = (await retryBids(userId, [id])) > 0;
  return { saved: answers.length, retried };
}
