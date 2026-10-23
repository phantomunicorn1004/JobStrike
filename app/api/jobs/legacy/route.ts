import { NextRequest } from "next/server";
import { corsJson, corsOptions } from "@/lib/api/extensionCors";
import { requireRequestUser, unauthorizedJson } from "@/lib/auth/resolve-request-user";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * The older Applied / Technical tables (/jobs-applied, /jobs-technical). They used to query the
 * database from the browser with the public key, unscoped; now only the signed-in user's rows are
 * returned, and only the fields those pages edit can change.
 */
const TABLES = {
  jobs: { editable: ["note"] },
  technical_jobs: {
    editable: [
      "first_round_date", "first_round_result",
      "second_round_date", "second_round_result",
      "third_round_date", "third_round_result",
    ],
  },
} as const;

type TableName = keyof typeof TABLES;

const NEW_TECHNICAL_JOB_FIELDS = [
  "name", "company_name", "title", "job_description", "resume_link",
  "recruiter_name", "recruiter_contact",
  "first_round_date", "first_round_result",
  "second_round_date", "second_round_result",
  "third_round_date", "third_round_result",
  "status",
] as const;

const PAGE = 1000;
const MAX_ROWS = 20000;

export function OPTIONS() {
  return corsOptions();
}

function tableFrom(value: unknown): TableName {
  if (value === "jobs" || value === "technical_jobs") return value;
  throw new Error("Unknown table.");
}

function errorResponse(error: unknown, fallback: string) {
  if (error instanceof Error && error.message === "Unauthorized") {
    return corsJson(unauthorizedJson(), { status: 401 });
  }
  console.error("Legacy jobs error:", error);
  return corsJson({ error: error instanceof Error ? error.message : fallback }, { status: 400 });
}

/** Query: ?table=jobs|technical_jobs — the user's rows, newest first. */
export async function GET(request: NextRequest) {
  try {
    const user = await requireRequestUser(request);
    const table = tableFrom(request.nextUrl.searchParams.get("table"));
    const supabase = getSupabaseAdminClient();
    const rows: unknown[] = [];
    for (let from = 0; from < MAX_ROWS; from += PAGE) {
      const { data, error } = await supabase
        .from(table)
        .select("*")
        .eq("user_id", user.id)
        .order("id", { ascending: false })
        .range(from, from + PAGE - 1);
      if (error) throw error;
      rows.push(...(data ?? []));
      if (!data || data.length < PAGE) break;
    }
    return corsJson({ rows });
  } catch (error) {
    return errorResponse(error, "Failed to load jobs.");
  }
}

/** Body: { table, id, column, value } — one editable field of one of the user's rows. */
export async function PATCH(request: NextRequest) {
  try {
    const user = await requireRequestUser(request);
    const body = await request.json();
    const table = tableFrom(body.table);
    const column = String(body.column ?? "");
    if (!(TABLES[table].editable as readonly string[]).includes(column)) {
      throw new Error("This field cannot be changed here.");
    }
    const value = body.value === null ? null : String(body.value ?? "");
    const { data, error } = await getSupabaseAdminClient()
      .from(table)
      .update({ [column]: column.endsWith("_date") && !value ? null : value } as never)
      .eq("id", Number(body.id))
      .eq("user_id", user.id)
      .select("id");
    if (error) throw error;
    if (!data?.length) throw new Error("Job not found.");
    return corsJson({ ok: true });
  } catch (error) {
    return errorResponse(error, "Failed to save.");
  }
}

/** Body: { table: "technical_jobs", job: {...} } — adds a job by hand. */
export async function POST(request: NextRequest) {
  try {
    const user = await requireRequestUser(request);
    const body = await request.json();
    if (tableFrom(body.table) !== "technical_jobs") throw new Error("Jobs can only be added to technical_jobs here.");
    const input = (body.job ?? {}) as Record<string, unknown>;
    const row: Record<string, unknown> = { user_id: user.id };
    for (const field of NEW_TECHNICAL_JOB_FIELDS) {
      const value = input[field];
      row[field] = field.endsWith("_date") ? (value ? String(value) : null) : String(value ?? "");
    }
    row.status = row.status || "ongoing";
    for (const required of ["name", "company_name", "title", "resume_link"]) {
      if (!String(row[required] ?? "").trim()) throw new Error("Please fill out all required fields.");
    }
    const { data, error } = await getSupabaseAdminClient()
      .from("technical_jobs")
      .insert(row as never)
      .select();
    if (error) throw error;
    return corsJson({ rows: data ?? [] });
  } catch (error) {
    return errorResponse(error, "Failed to create the job.");
  }
}
