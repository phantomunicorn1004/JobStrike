import { google } from "googleapis";
import {
  getGoogleAuth,
  getSheetId,
  getSheetTabName,
} from "@/lib/google-sheets/client";
import {
  RESUME_DB_COLUMNS,
  type ResumeDbEntry,
  type ResumeDbEntryInput,
} from "@/lib/google-sheets/types";

const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";

type HeaderMap = Record<string, number>;

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "_");
}

function buildHeaderMap(headerRow: string[]): HeaderMap {
  const map: HeaderMap = {};
  headerRow.forEach((cell, index) => {
    const key = normalizeHeader(cell);
    if (key) map[key] = index;
  });

  // Legacy column name from sheet screenshot
  if (map.resume_url == null && map.resume_id != null) {
    map.resume_url = map.resume_id;
  }

  return map;
}

function cell(row: string[], index: number | undefined): string {
  if (index == null || index < 0) return "";
  return String(row[index] ?? "").trim();
}

function rowToEntry(rowIndex: number, row: string[], headers: HeaderMap): ResumeDbEntry {
  return {
    rowIndex,
    candidate: cell(row, headers.candidate),
    email: cell(row, headers.email),
    jobLink: cell(row, headers.job_link ?? headers.joblink),
    apply: cell(row, headers.apply),
    jobTitle: cell(row, headers.job_title ?? headers.jobtitle),
    company: cell(row, headers.company),
    resumeUrl: cell(row, headers.resume_url ?? headers.resume_id),
    date: cell(row, headers.date),
  };
}

function entryToRowValues(entry: ResumeDbEntryInput): string[] {
  return [
    entry.candidate,
    entry.email,
    entry.jobLink,
    entry.apply,
    entry.jobTitle,
    entry.company,
    entry.resumeUrl,
    entry.date,
  ];
}

function tabRange(suffix: string): string {
  const tab = getSheetTabName();
  const escaped = tab.includes(" ") ? `'${tab.replace(/'/g, "''")}'` : tab;
  return `${escaped}!${suffix}`;
}

async function getSheetsClient() {
  const auth = getGoogleAuth([SHEETS_SCOPE]);
  return google.sheets({ version: "v4", auth });
}

async function readAllRows(): Promise<{
  headers: HeaderMap;
  rows: { rowIndex: number; values: string[] }[];
}> {
  const sheets = await getSheetsClient();
  const spreadsheetId = getSheetId();
  const range = tabRange("A:Z");

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
  });

  const values = (response.data.values ?? []) as string[][];
  if (values.length === 0) {
    return { headers: {}, rows: [] };
  }

  const headers = buildHeaderMap(values[0].map((c) => String(c ?? "")));
  const rows = values.slice(1).map((row, i) => ({
    rowIndex: i + 2,
    values: row.map((c) => String(c ?? "")),
  }));

  return { headers, rows };
}

function isRowEmpty(row: string[]): boolean {
  return row.every((c) => !String(c).trim());
}

export async function listResumeDbEntries(): Promise<ResumeDbEntry[]> {
  const { headers, rows } = await readAllRows();
  return rows
    .filter((r) => !isRowEmpty(r.values))
    .map((r) => rowToEntry(r.rowIndex, r.values, headers));
}

export async function getResumeDbEntry(
  rowIndex: number,
): Promise<ResumeDbEntry | null> {
  const entries = await listResumeDbEntries();
  return entries.find((e) => e.rowIndex === rowIndex) ?? null;
}

export async function appendResumeDbEntry(
  entry: ResumeDbEntryInput,
): Promise<{ rowIndex: number }> {
  const sheets = await getSheetsClient();
  const spreadsheetId = getSheetId();

  const { headers, rows } = await readAllRows();
  const nextRowIndex = rows.length > 0 ? rows[rows.length - 1].rowIndex + 1 : 2;

  if (Object.keys(headers).length === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: tabRange("A1:H1"),
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [RESUME_DB_COLUMNS.slice()],
      },
    });
  }

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: tabRange("A:H"),
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [entryToRowValues(entry)],
    },
  });

  return { rowIndex: nextRowIndex };
}

export async function updateResumeDbEntry(
  rowIndex: number,
  entry: ResumeDbEntryInput,
): Promise<void> {
  const sheets = await getSheetsClient();
  const spreadsheetId = getSheetId();

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: tabRange(`A${rowIndex}:H${rowIndex}`),
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [entryToRowValues(entry)],
    },
  });
}

export async function deleteResumeDbEntry(rowIndex: number): Promise<void> {
  const sheets = await getSheetsClient();
  const spreadsheetId = getSheetId();

  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets.properties",
  });

  const tabName = getSheetTabName();
  const sheet = meta.data.sheets?.find(
    (s) => s.properties?.title === tabName,
  );
  const sheetId = sheet?.properties?.sheetId;
  if (sheetId == null) {
    throw new Error(`Sheet tab "${tabName}" not found in spreadsheet.`);
  }

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId,
              dimension: "ROWS",
              startIndex: rowIndex - 1,
              endIndex: rowIndex,
            },
          },
        },
      ],
    },
  });
}
