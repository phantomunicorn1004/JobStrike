import type { ProfilePromptKit } from "@/lib/resume-builder/promptKitStorage";

const PROMPT_KIT_BRIDGE_SOURCE = "rwh-resume-builder";

type PromptKitBridgeSaveMessage = {
  source: typeof PROMPT_KIT_BRIDGE_SOURCE;
  type: "prompt-kit-save";
  requestId: string;
  profileId: number;
  kit: ProfilePromptKit;
};

type PromptKitBridgeGetMessage = {
  source: typeof PROMPT_KIT_BRIDGE_SOURCE;
  type: "prompt-kit-get";
  requestId: string;
  profileId: number;
};

type PromptKitBridgeSaveResult = {
  source: typeof PROMPT_KIT_BRIDGE_SOURCE;
  type: "prompt-kit-save-result";
  requestId: string;
  ok: boolean;
  error?: string;
  kit?: ProfilePromptKit;
};

type PromptKitBridgeGetResult = {
  source: typeof PROMPT_KIT_BRIDGE_SOURCE;
  type: "prompt-kit-get-result";
  requestId: string;
  ok: boolean;
  exists: boolean;
  kit?: ProfilePromptKit;
  error?: string;
};

function newRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function waitForBridgeResult<T extends { requestId: string; type: string }>(
  requestId: string,
  resultType: T["type"],
  timeoutMs: number,
): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      window.removeEventListener("message", onMessage);
      resolve(null);
    }, timeoutMs);

    function onMessage(event: MessageEvent) {
      if (event.source !== window) return;
      const data = event.data as (T & { source?: string }) | null;
      if (!data || data.source !== PROMPT_KIT_BRIDGE_SOURCE) return;
      if (data.requestId !== requestId || data.type !== resultType) return;
      window.clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      resolve(data);
    }

    window.addEventListener("message", onMessage);
  });
}

/** Push a saved kit into the extension chrome.storage (via content-script bridge). */
export async function syncPromptKitToExtension(
  profileId: number,
  kit: ProfilePromptKit,
  timeoutMs = 2000,
): Promise<{ ok: boolean; synced: boolean; error?: string; kit?: ProfilePromptKit }> {
  if (typeof window === "undefined") {
    return { ok: false, synced: false, error: "Not in browser." };
  }

  const requestId = newRequestId();
  const message: PromptKitBridgeSaveMessage = {
    source: PROMPT_KIT_BRIDGE_SOURCE,
    type: "prompt-kit-save",
    requestId,
    profileId,
    kit,
  };

  const pending = waitForBridgeResult<PromptKitBridgeSaveResult>(
    requestId,
    "prompt-kit-save-result",
    timeoutMs,
  );
  window.postMessage(message, window.location.origin);
  const result = await pending;

  if (!result) {
    return {
      ok: true,
      synced: false,
      error: "Extension not available on this page.",
    };
  }
  if (!result.ok) {
    return {
      ok: false,
      synced: false,
      error: result.error || "Extension sync failed.",
    };
  }
  return { ok: true, synced: true, kit: result.kit };
}
