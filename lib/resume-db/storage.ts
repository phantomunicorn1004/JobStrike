import { randomUUID } from "crypto";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

const BUCKET = "resume-db";

function sanitizeFileName(name: string): string {
  return name.replace(/[^\w.\-()+\s]/g, "_").replace(/\s+/g, "_").slice(0, 80);
}

export function newEntryId(): string {
  return randomUUID().replace(/-/g, "").slice(0, 12);
}

export function buildStoragePath(
  entryId: string,
  kind: "resume" | "cover",
  originalName: string,
): string {
  const ext = originalName.includes(".")
    ? originalName.slice(originalName.lastIndexOf("."))
    : ".pdf";
  const base = sanitizeFileName(
    originalName.replace(/\.[^/.]+$/, "") || kind,
  );
  return `${entryId}/${kind}_${base}${ext}`;
}

export async function uploadApplicationFile(
  buffer: Buffer,
  storagePath: string,
  contentType: string,
): Promise<{ publicUrl: string; storagePath: string }> {
  const supabase = getSupabaseAdminClient();

  const { error } = await supabase.storage.from(BUCKET).upload(storagePath, buffer, {
    contentType,
    upsert: false,
  });

  if (error) {
    throw new Error(`File upload failed: ${error.message}`);
  }

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);
  if (!data.publicUrl) {
    throw new Error("Could not resolve public URL for uploaded file.");
  }

  return { publicUrl: data.publicUrl, storagePath };
}

export function guessContentType(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".docx")) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (lower.endsWith(".doc")) return "application/msword";
  if (lower.endsWith(".txt")) return "text/plain";
  return "application/octet-stream";
}
