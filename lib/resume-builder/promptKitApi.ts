import type { ProfilePromptKit } from "@/lib/resume-builder/promptKitStorage";
import { emptyProfilePromptKit } from "@/lib/resume-builder/promptKitStorage";

export type FetchPromptKitResult = {
  kit: ProfilePromptKit;
  exists: boolean;
  profileId: number;
};

export async function fetchProfilePromptKit(
  profileId: number,
): Promise<FetchPromptKitResult> {
  const res = await fetch(`/api/profiles/${profileId}/prompt-kit`, {
    method: "GET",
    credentials: "same-origin",
  });
  const data = (await res.json().catch(() => ({}))) as {
    kit?: Partial<ProfilePromptKit>;
    exists?: boolean;
    profileId?: number;
    error?: string;
  };
  if (!res.ok) {
    throw new Error(data.error || `Failed to load prompt kit (${res.status})`);
  }
  return {
    kit: emptyProfilePromptKit(data.kit ?? {}),
    exists: Boolean(data.exists),
    profileId: data.profileId ?? profileId,
  };
}

export async function saveProfilePromptKit(
  profileId: number,
  kit: ProfilePromptKit,
): Promise<FetchPromptKitResult> {
  const res = await fetch(`/api/profiles/${profileId}/prompt-kit`, {
    method: "PUT",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      template: kit.template,
      resumeTemplateJson: kit.resumeTemplateJson,
      jobDescription: kit.jobDescription,
      output: kit.output,
    }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    kit?: Partial<ProfilePromptKit>;
    exists?: boolean;
    profileId?: number;
    error?: string;
  };
  if (!res.ok) {
    throw new Error(data.error || `Failed to save prompt kit (${res.status})`);
  }
  return {
    kit: emptyProfilePromptKit(data.kit ?? {}),
    exists: data.exists !== false,
    profileId: data.profileId ?? profileId,
  };
}

/** True if local draft has anything beyond a blank default kit. */
export function localPromptKitHasDraft(kit: ProfilePromptKit): boolean {
  const defaults = emptyProfilePromptKit();
  return Boolean(
    kit.resumeTemplateJson.trim() ||
      kit.jobDescription.trim() ||
      kit.output.trim() ||
      kit.template.trim() !== defaults.template.trim(),
  );
}
