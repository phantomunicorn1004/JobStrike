import { google } from "googleapis";
import { getGoogleAuth } from "@/lib/google-sheets/client";

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.readonly";

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PDF_MIME = "application/pdf";

export function extractGoogleDriveFileId(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;

  const patterns = [
    /\/file\/d\/([a-zA-Z0-9_-]+)/,
    /\/document\/d\/([a-zA-Z0-9_-]+)/,
    /[?&]id=([a-zA-Z0-9_-]+)/,
  ];

  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (match?.[1]) return match[1];
  }

  return null;
}

export type DriveDownloadResult = {
  buffer: Buffer;
  fileName: string;
  mimeType: string;
};

export async function downloadFromGoogleDriveUrl(
  url: string,
): Promise<DriveDownloadResult> {
  const fileId = extractGoogleDriveFileId(url);
  if (!fileId) {
    throw new Error(
      "Invalid Google Drive URL. Use a share link to the resume file (PDF or DOCX).",
    );
  }

  const auth = getGoogleAuth([DRIVE_SCOPE]);
  const drive = google.drive({ version: "v3", auth });

  const meta = await drive.files.get({
    fileId,
    fields: "name, mimeType",
    supportsAllDrives: true,
  });

  const name = meta.data.name ?? "resume";
  const mimeType = meta.data.mimeType ?? "";

  let buffer: Buffer;
  let resolvedMime = mimeType;
  let fileName = name;

  if (mimeType === "application/vnd.google-apps.document") {
    const exported = await drive.files.export(
      { fileId, mimeType: DOCX_MIME },
      { responseType: "arraybuffer" },
    );
    buffer = Buffer.from(exported.data as ArrayBuffer);
    resolvedMime = DOCX_MIME;
    fileName = name.endsWith(".docx") ? name : `${name}.docx`;
  } else if (mimeType === "application/vnd.google-apps.spreadsheet") {
    throw new Error(
      "Google Sheets files are not supported as resumes. Upload a PDF or DOCX file to Drive.",
    );
  } else {
    const downloaded = await drive.files.get(
      { fileId, alt: "media", supportsAllDrives: true },
      { responseType: "arraybuffer" },
    );
    buffer = Buffer.from(downloaded.data as ArrayBuffer);
    if (!fileName.toLowerCase().endsWith(".pdf") && mimeType === PDF_MIME) {
      fileName = `${name}.pdf`;
    }
    if (!fileName.toLowerCase().endsWith(".docx") && mimeType === DOCX_MIME) {
      fileName = `${name}.docx`;
    }
  }

  if (
    !resolvedMime.includes("pdf") &&
    !resolvedMime.includes("wordprocessingml") &&
    !fileName.toLowerCase().endsWith(".pdf") &&
    !fileName.toLowerCase().endsWith(".docx")
  ) {
    throw new Error(
      `Unsupported file type "${mimeType || "unknown"}". Resume must be PDF or DOCX.`,
    );
  }

  return { buffer, fileName, mimeType: resolvedMime };
}
