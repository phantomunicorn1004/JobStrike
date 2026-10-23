import "server-only";

import { failOn } from "@/lib/integrations/accounts-repository";
import type { MailAutomation } from "@/lib/integrations/types";
import { isStillAMove, planMove, resolveStageRoles, type StageRoles } from "@/lib/mail/board-rules";
import type { MailCategory } from "@/lib/mail/categories";
import {
  getPipelineEvent,
  markPipelineEventUndone,
  recordPipelineEvent,
} from "@/lib/pipeline-events/repository";
import { listPipelineStages, setApplicationPipelineStage } from "@/lib/resume-db/pipeline-stages";
import { getApplicationById } from "@/lib/resume-db/repository";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Board updates from emails (docs/EMAIL_CALENDAR_INTEGRATION.md, section 6). Every sorted email is
 * checked once. In "auto" mode a sure email received after the mailbox's automation start moves the
 * card; everything else becomes a suggestion (older mail, unsure matches, "suggest" mode).
 */

/** Categories that can move a card. */
const MOVING: MailCategory[] = ["rejection", "interview", "assessment", "offer"];
/** Auto mode needs the type this sure (the match must be sure as well). */
const AUTO_CONFIDENCE = 0.75;
const SURE_MATCH = 0.6;

export type MailAction = { kind: "move"; toStage: string; fromStage: string | null; reason: string; eventId?: number | null };

type CheckRow = {
  id: string;
  user_id: string;
  account_id: string;
  category: MailCategory;
  confidence: number | null;
  application_id: number | null;
  match_score: number | null;
  link_source: string;
  extracted: { company?: string | null; interviewStage?: string | null } | null;
  subject: string | null;
  summary: string | null;
  received_at: string;
};

const messages = () => getSupabaseAdminClient().from("mail_messages");

async function boardRoles(): Promise<StageRoles> {
  return resolveStageRoles(await listPipelineStages());
}

/** Where the application's card is now (null = Registered), as Resume DB caches it. */
async function currentStage(userId: string, applicationId: number): Promise<string | null | undefined> {
  const app = await getApplicationById(applicationId, userId);
  if (!app) return undefined;
  return app.pipelineStageId ?? (app.pipelineJobId ? "applied" : null);
}

/** Moves the card, logs the move, and returns the log entry's id. */
async function move(
  userId: string,
  applicationId: number,
  action: MailAction,
  messageId: string,
  receivedAt: string,
): Promise<number | null> {
  // The column date is the email's date, so the dashboard's response times stay true.
  await setApplicationPipelineStage(applicationId, userId, action.toStage, { enteredAt: receivedAt });
  return recordPipelineEvent(userId, {
    applicationId,
    fromStage: action.fromStage,
    toStage: action.toStage,
    source: "email",
    refId: messageId,
    reason: action.reason,
  });
}

export type ActionResult = { moved: number; suggested: number };

/** Checks sorted emails that were not checked yet, oldest first, until `deadline` is near. */
export async function applyPendingActions(userId: string | null, deadline: number): Promise<ActionResult> {
  const result: ActionResult = { moved: 0, suggested: 0 };
  let roles: StageRoles | null = null;
  const accounts = new Map<string, { automation: MailAutomation; since: string } | null>();

  while (Date.now() < deadline - 8_000) {
    let query = messages()
      .select("id, user_id, account_id, category, confidence, application_id, match_score, link_source, extracted, subject, summary, received_at")
      .is("action_checked_at", null)
      .neq("category", "unclassified");
    if (userId) query = query.eq("user_id", userId);
    const { data, error } = await query.order("received_at", { ascending: true }).limit(100);
    failOn(error);
    const rows = (data ?? []) as CheckRow[];
    if (rows.length === 0) break;

    // Take them: a row another run took meanwhile is skipped.
    const { data: claimedRows, error: claimError } = await messages()
      .update({ action_checked_at: new Date().toISOString() } as never)
      .in("id", rows.map((r) => r.id))
      .is("action_checked_at", null)
      .select("id");
    failOn(claimError);
    const claimed = new Set(((claimedRows ?? []) as { id: string }[]).map((r) => r.id));
    if (claimed.size === 0) break;

    roles ??= await boardRoles();
    // Cards move one after another, in email order, so each sees the previous move.
    const stages = new Map<number, string | null | undefined>();
    for (const row of rows) {
      if (!claimed.has(row.id) || !row.application_id || !MOVING.includes(row.category)) continue;
      if (Date.now() > deadline - 4_000) {
        // Out of time: give it back for the next run.
        await messages().update({ action_checked_at: null } as never).eq("id", row.id);
        continue;
      }
      try {
        if (!accounts.has(row.account_id)) {
          const { data: account } = await getSupabaseAdminClient()
            .from("mail_accounts")
            .select("automation, automation_since")
            .eq("id", row.account_id)
            .maybeSingle();
          const a = account as { automation: MailAutomation; automation_since: string } | null;
          accounts.set(row.account_id, a ? { automation: a.automation, since: a.automation_since } : null);
        }
        const account = accounts.get(row.account_id);
        if (!account || account.automation === "off") continue;

        if (!stages.has(row.application_id)) stages.set(row.application_id, await currentStage(row.user_id, row.application_id));
        const current = stages.get(row.application_id);
        if (current === undefined) continue;

        const plan = planMove({
          category: row.category,
          interviewStage: row.extracted?.interviewStage ?? null,
          text: `${row.subject ?? ""} ${row.summary ?? ""}`,
          currentStage: current,
          roles,
          company: row.extracted?.company ?? "",
          receivedAt: row.received_at,
        });
        if (!plan) continue;

        const sure = row.link_source === "user" || (row.match_score ?? 0) >= SURE_MATCH;
        const auto =
          account.automation === "auto" &&
          sure &&
          (row.confidence ?? 0) >= AUTO_CONFIDENCE &&
          new Date(row.received_at) >= new Date(account.since);

        const action: MailAction = { kind: "move", ...plan };
        if (auto) {
          action.eventId = await move(row.user_id, row.application_id, action, row.id, row.received_at);
          stages.set(row.application_id, plan.toStage);
          await messages().update({ action, action_status: "applied" } as never).eq("id", row.id);
          result.moved++;
        } else {
          await messages().update({ action, action_status: "suggested" } as never).eq("id", row.id);
          result.suggested++;
        }
      } catch (error) {
        // Logged by id only; the email stays checked and can be handled by hand.
        console.error(`Board update for email ${row.id} failed:`, error instanceof Error ? error.message : error);
      }
    }
  }
  return result;
}

type ActionRow = {
  id: string;
  application_id: number | null;
  action: MailAction | null;
  action_status: string;
  received_at: string;
};

async function getActionRow(userId: string, messageId: string): Promise<ActionRow | null> {
  const { data, error } = await messages()
    .select("id, application_id, action, action_status, received_at")
    .eq("id", messageId)
    .eq("user_id", userId)
    .maybeSingle();
  failOn(error);
  return (data as ActionRow | null) ?? null;
}

/** Other suggestions for the same application that a move made pointless are dismissed. */
async function tidySuggestions(userId: string, applicationId: number, roles: StageRoles): Promise<void> {
  const current = await currentStage(userId, applicationId);
  if (current === undefined) return;
  const { data } = await messages()
    .select("id, action")
    .eq("user_id", userId)
    .eq("application_id", applicationId)
    .eq("action_status", "suggested");
  const stale = ((data ?? []) as { id: string; action: MailAction | null }[]).filter(
    (r) => !r.action || !isStillAMove(roles, current, r.action.toStage),
  );
  if (stale.length) {
    await messages().update({ action_status: "dismissed" } as never).in("id", stale.map((r) => r.id));
  }
}

export type ActionOutcome = { ok: boolean; message: string };

/** The user applies one suggestion. */
export async function applySuggestion(userId: string, messageId: string, roles?: StageRoles): Promise<ActionOutcome> {
  const row = await getActionRow(userId, messageId);
  if (!row || row.action_status !== "suggested" || !row.action || !row.application_id) {
    return { ok: false, message: "There is nothing to apply for this email." };
  }
  const board = roles ?? (await boardRoles());
  const current = await currentStage(userId, row.application_id);
  if (current === undefined) return { ok: false, message: "The application no longer exists." };
  if (!isStillAMove(board, current, row.action.toStage)) {
    await messages().update({ action_status: "dismissed" } as never).eq("id", row.id);
    return { ok: false, message: "The card is already further along." };
  }
  const action: MailAction = { ...row.action, fromStage: current };
  action.eventId = await move(userId, row.application_id, action, row.id, row.received_at);
  await messages().update({ action, action_status: "applied" } as never).eq("id", row.id);
  await tidySuggestions(userId, row.application_id, board);
  return { ok: true, message: "Moved." };
}

export async function dismissSuggestion(userId: string, messageId: string): Promise<void> {
  const { error } = await messages()
    .update({ action_status: "dismissed" } as never)
    .eq("id", messageId)
    .eq("user_id", userId)
    .eq("action_status", "suggested");
  failOn(error);
}

/** Applies every suggestion, oldest email first, until `deadline` is near. */
export async function applyAllSuggestions(userId: string, deadline: number): Promise<{ applied: number; skipped: number; remaining: number }> {
  const roles = await boardRoles();
  let applied = 0;
  let skipped = 0;
  while (Date.now() < deadline - 6_000) {
    const { data, error } = await messages()
      .select("id")
      .eq("user_id", userId)
      .eq("action_status", "suggested")
      .order("received_at", { ascending: true })
      .limit(25);
    failOn(error);
    const ids = ((data ?? []) as { id: string }[]).map((r) => r.id);
    if (ids.length === 0) break;
    for (const id of ids) {
      if (Date.now() > deadline - 4_000) break;
      try {
        const outcome = await applySuggestion(userId, id, roles);
        if (outcome.ok) applied++;
        else skipped++;
      } catch (error) {
        console.error(`Applying suggestion ${id} failed:`, error instanceof Error ? error.message : error);
        await dismissSuggestion(userId, id).catch(() => {});
        skipped++;
      }
    }
  }
  const { count } = await messages()
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("action_status", "suggested");
  return { applied, skipped, remaining: count ?? 0 };
}

/** Undoes a logged move, if the card is still where that move put it. */
export async function undoPipelineEvent(userId: string, eventId: number): Promise<ActionOutcome> {
  const event = await getPipelineEvent(userId, eventId);
  if (!event) return { ok: false, message: "That change was not found." };
  if (event.undoneAt) return { ok: false, message: "That change was already undone." };
  const current = await currentStage(userId, event.applicationId);
  if (current === undefined) return { ok: false, message: "The application no longer exists." };
  if (current !== event.toStage) {
    return { ok: false, message: "The card was moved since; move it on the board instead." };
  }
  await setApplicationPipelineStage(event.applicationId, userId, event.fromStage);
  await markPipelineEventUndone(userId, eventId);
  if (event.refId) {
    // The email does not move the card again.
    await messages().update({ action_status: "dismissed" } as never).eq("id", event.refId).eq("user_id", userId);
  }
  return { ok: true, message: "Undone." };
}
