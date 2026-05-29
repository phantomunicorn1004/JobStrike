/** Extract a Google Drive file ID from common sharing / view URLs. */
export function extractGoogleDriveFileId(url: string): string | null {
  if (!url?.trim()) return null;
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.includes("google.com")) return null;

    const pathMatch = parsed.pathname.match(/\/file\/d\/([^/]+)/);
    if (pathMatch?.[1]) return pathMatch[1];

    const openId = parsed.searchParams.get("id");
    if (openId) return openId;

    const ucId = parsed.pathname.match(/\/uc\/?$/);
    if (ucId) {
      const id = parsed.searchParams.get("id");
      if (id) return id;
    }
  } catch {
    return null;
  }
  return null;
}

export function googleDriveViewUrl(fileId: string): string {
  return `https://drive.google.com/file/d/${fileId}/view?usp=sharing`;
}

/** Public download URL (works when file has "anyone with link" reader permission). */
export function googleDriveDirectDownloadUrl(fileId: string): string {
  return `https://drive.google.com/uc?export=download&id=${fileId}`;
}

export function isGoogleDriveUrl(url: string): boolean {
  return Boolean(extractGoogleDriveFileId(url));
}
