import { googleDriveDirectDownloadUrl } from "@/lib/google-drive/urls";

function filenameFromContentDisposition(header: string | null): string | null {
  if (!header) return null;
  const star = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1].trim());
    } catch {
      return star[1].trim();
    }
  }
  const plain = header.match(/filename="?([^";]+)"?/i);
  return plain?.[1]?.trim() || null;
}

function looksLikeHtml(buffer: Buffer): boolean {
  const head = buffer.subarray(0, 256).toString("utf8").toLowerCase();
  return head.includes("<!doctype") || head.includes("<html");
}

function extractDriveConfirmToken(html: string): string | null {
  const fromLink = html.match(/confirm=([0-9A-Za-z_-]+)/);
  if (fromLink?.[1]) return fromLink[1];
  const fromInput = html.match(/name="confirm"\s+value="([0-9A-Za-z_-]+)"/i);
  if (fromInput?.[1]) return fromInput[1];
  return null;
}

/** Download a link-shared Drive file without OAuth (handles virus-scan HTML interstitial). */
export async function downloadGoogleDrivePublicFile(
  fileId: string,
  fallbackName: string,
): Promise<{ buffer: Buffer; fileName: string; contentType: string }> {
  const candidates = [
    googleDriveDirectDownloadUrl(fileId),
    `https://drive.usercontent.google.com/download?id=${fileId}&export=download`,
  ];

  let lastError: Error | null = null;

  for (const startUrl of candidates) {
    try {
      let res = await fetch(startUrl, { redirect: "follow" });
      if (!res.ok) {
        lastError = new Error(`Drive download failed (${res.status})`);
        continue;
      }

      let buffer = Buffer.from(await res.arrayBuffer());

      if (looksLikeHtml(buffer)) {
        const html = buffer.toString("utf8");
        const confirm = extractDriveConfirmToken(html) || "t";
        const retryUrl = `${googleDriveDirectDownloadUrl(fileId)}&confirm=${confirm}`;
        res = await fetch(retryUrl, { redirect: "follow" });
        if (!res.ok) {
          lastError = new Error(`Drive download failed (${res.status})`);
          continue;
        }
        buffer = Buffer.from(await res.arrayBuffer());
        if (looksLikeHtml(buffer)) {
          lastError = new Error("Drive returned HTML instead of file bytes.");
          continue;
        }
      }

      const fileName =
        filenameFromContentDisposition(res.headers.get("content-disposition")) ||
        fallbackName;
      const contentType =
        res.headers.get("content-type")?.split(";")[0]?.trim() ||
        "application/octet-stream";

      return { buffer, fileName, contentType };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  throw lastError ?? new Error("Drive download failed.");
}
