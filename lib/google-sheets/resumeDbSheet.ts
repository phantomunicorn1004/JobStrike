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

  if (map.resume_url == null && map.resume_id != null) {
    map.resume_url = map.resume_id;
  }
  if (map.cover_letter_url == null && map.cover_letter_link != null) {
    map.cover_letter_url = map.cover_letter_link;
  }
  if (map.job_link == null && map.joblink != null) {
    map.job_link = map.joblink;
  }
  if (map.job_title == null && map.jobtitle != null) {
    map.job_title = map.jobtitle;
  }

  return map;
}

function cell(row: string[], index: number | undefined): string {
  if (index == null || index < 0) return "";
  return String(row[index] ?? "").trim();
}

function rowToEntry(
  rowIndex: number,
  row: string[],
  headers: HeaderMap,
): ResumeDbEntry {
  return {
    rowIndex,
    entryId: cell(row, headers.entry_id),
    candidate: cell(row, headers.candidate),
    email: cell(row, headers.email),
    jobLink: cell(row, headers.job_link),
    apply: cell(row, headers.apply),
    jobTitle: cell(row, headers.job_title),
    company: cell(row, headers.company),
    resumeUrl: cell(row, headers.resume_url),
    coverLetterUrl: cell(row, headers.cover_letter_url),
    date: cell(row, headers.date),
  };
}

function entryToRowValues(
  entry: ResumeDbEntryInput,
  headers: HeaderMap,
  headerRow: string[],
): string[] {
  const fieldMap: Record<string, string> = {
    entry_id: entry.entryId,
    candidate: entry.candidate,
    email: entry.email,
    job_link: entry.jobLink,
    apply: entry.apply,
    job_title: entry.jobTitle,
    company: entry.company,
    resume_url: entry.resumeUrl,
    cover_letter_url: entry.coverLetterUrl,
    date: entry.date,
  };

  if (headerRow.length === 0) {
    return RESUME_DB_COLUMNS.map((col) => {
      const key = normalizeHeader(col);
      return fieldMap[key] ?? "";
    });
  }

  return headerRow.map((col) => {
    const key = normalizeHeader(col);
    return fieldMap[key] ?? "";
  });
}

function tabRange(suffix: string): string {
  const tab = getSheetTabName();
  const escaped = tab.includes(" ") ? `'${tab.replace(/'/g, "''")}'` : tab;
  return `${escaped}!${suffix}`;
}

function columnLetter(count: number): string {
  let n = count;
  let s = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s || "A";
}

async function getSheetsClient() {
  const auth = getGoogleAuth([SHEETS_SCOPE]);
  return google.sheets({ version: "v4", auth });
}

async function readSheetData(): Promise<{
  headers: HeaderMap;
  headerRow: string[];
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
    return { headers: {}, headerRow: [], rows: [] };
  }

  const headerRow = values[0].map((c) => String(c ?? ""));
  const headers = buildHeaderMap(headerRow);
  const rows = values.slice(1).map((row, i) => ({
    rowIndex: i + 2,
    values: row.map((c) => String(c ?? "")),
  }));

  return { headers, headerRow, rows };
}

function isRowEmpty(row: string[]): boolean {
  return row.every((c) => !String(c).trim());
}

async function ensureHeaderRow(): Promise<{
  headers: HeaderMap;
  headerRow: string[];
}> {
  const data = await readSheetData();
  if (data.headerRow.length > 0 && Object.keys(data.headers).length > 0) {
    return { headers: data.headers, headerRow: data.headerRow };
  }

  const sheets = await getSheetsClient();
  const spreadsheetId = getSheetId();
  const headerRow = RESUME_DB_COLUMNS.slice();
  const endCol = columnLetter(headerRow.length);

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: tabRange(`A1:${endCol}1`),
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [headerRow] },
  });

  return { headers: buildHeaderMap(headerRow), headerRow };
}

export async function listResumeDbEntries(): Promise<ResumeDbEntry[]> {
  const { headers, rows } = await readSheetData();
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

export async function getResumeDbEntryByEntryId(
  entryId: string,
): Promise<ResumeDbEntry | null> {
  const entries = await listResumeDbEntries();
  return entries.find((e) => e.entryId === entryId) ?? null;
}

export async function appendResumeDbEntry(
  entry: ResumeDbEntryInput,
): Promise<{ rowIndex: number }> {
  const sheets = await getSheetsClient();
  const spreadsheetId = getSheetId();
  const { headers, headerRow } = await ensureHeaderRow();
  const { rows } = await readSheetData();
  const nextRowIndex = rows.length > 0 ? rows[rows.length - 1].rowIndex + 1 : 2;
  const endCol = columnLetter(
    Math.max(headerRow.length, RESUME_DB_COLUMNS.length),
  );

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: tabRange(`A:${endCol}`),
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [entryToRowValues(entry, headers, headerRow)],
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
  const { headers, headerRow } = await ensureHeaderRow();
  const endCol = columnLetter(
    Math.max(headerRow.length, RESUME_DB_COLUMNS.length),
  );

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: tabRange(`A${rowIndex}:${endCol}${rowIndex}`),
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [entryToRowValues(entry, headers, headerRow)],
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
  const sheet = meta.data.sheets?.find((s) => s.properties?.title === tabName);
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
