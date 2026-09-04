export const JSON2DOCX_OUTPUT_MODES = ["docx", "pdf", "both"] as const;

export type Json2docxOutputMode = (typeof JSON2DOCX_OUTPUT_MODES)[number];

export type Json2docxSettings = {
  enabled: boolean;
  baseUrl: string;
  outputMode: Json2docxOutputMode;
};

export const JSON2DOCX_STORAGE_KEYS = {
  enabled: "json2docx_enabled",
  baseUrl: "json2docx_base_url",
  outputMode: "json2docx_output_mode",
} as const;

export const DEFAULT_JSON2DOCX_SETTINGS: Json2docxSettings = {
  enabled: false,
  baseUrl: "http://127.0.0.1:8765",
  outputMode: "both",
};

export function normalizeJson2docxBaseUrl(value: string | null | undefined): string {
  let url = String(value ?? "").trim() || DEFAULT_JSON2DOCX_SETTINGS.baseUrl;
  url = url.replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(url)) {
    url = `http://${url}`;
  }
  return url;
}

export function normalizeJson2docxOutputMode(
  value: string | null | undefined,
): Json2docxOutputMode {
  const mode = String(value ?? "").trim().toLowerCase();
  return (JSON2DOCX_OUTPUT_MODES as readonly string[]).includes(mode)
    ? (mode as Json2docxOutputMode)
    : DEFAULT_JSON2DOCX_SETTINGS.outputMode;
}

export function readJson2docxSettingsFromStorage(
  storage: Pick<Storage, "getItem"> = globalThis.localStorage,
): Json2docxSettings {
  try {
    const rawEnabled = storage.getItem(JSON2DOCX_STORAGE_KEYS.enabled);
    return {
      enabled: rawEnabled === "true" || rawEnabled === "1",
      baseUrl: normalizeJson2docxBaseUrl(
        storage.getItem(JSON2DOCX_STORAGE_KEYS.baseUrl),
      ),
      outputMode: normalizeJson2docxOutputMode(
        storage.getItem(JSON2DOCX_STORAGE_KEYS.outputMode),
      ),
    };
  } catch {
    return { ...DEFAULT_JSON2DOCX_SETTINGS };
  }
}

export function writeJson2docxSettingsToStorage(
  settings: Json2docxSettings,
  storage: Pick<Storage, "setItem"> = globalThis.localStorage,
): Json2docxSettings {
  const next: Json2docxSettings = {
    enabled: Boolean(settings.enabled),
    baseUrl: normalizeJson2docxBaseUrl(settings.baseUrl),
    outputMode: normalizeJson2docxOutputMode(settings.outputMode),
  };
  storage.setItem(JSON2DOCX_STORAGE_KEYS.enabled, next.enabled ? "true" : "false");
  storage.setItem(JSON2DOCX_STORAGE_KEYS.baseUrl, next.baseUrl);
  storage.setItem(JSON2DOCX_STORAGE_KEYS.outputMode, next.outputMode);
  return next;
}

export function json2docxApiUrl(baseUrl: string, path: string): string {
  const root = normalizeJson2docxBaseUrl(baseUrl);
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${root}${suffix}`;
}

export type Json2docxHealthResult =
  | {
      ok: true;
      version: string;
      downloads?: string;
    }
  | {
      ok: false;
      error: string;
    };

export async function fetchJson2docxHealth(
  baseUrl: string,
  options: { timeoutMs?: number } = {},
): Promise<Json2docxHealthResult> {
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = controller
    ? setTimeout(() => controller.abort(), options.timeoutMs ?? 2500)
    : null;

  try {
    const response = await fetch(json2docxApiUrl(baseUrl, "/health"), {
      method: "GET",
      signal: controller?.signal,
    });
    const data = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      version?: string;
      downloads?: string;
      error?: string;
    };
    if (!response.ok || !data?.ok) {
      return {
        ok: false,
        error: data?.error || `Health check failed (${response.status})`,
      };
    }
    return {
      ok: true,
      version: data.version || "",
      downloads: data.downloads,
    };
  } catch (error) {
    const message =
      error instanceof Error && error.name === "AbortError"
        ? "Timed out"
        : error instanceof Error
          ? error.message
          : "Connection failed";
    return { ok: false, error: message };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
