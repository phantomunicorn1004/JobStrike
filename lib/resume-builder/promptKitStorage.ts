import { DEFAULT_PROMPT_TEMPLATE } from "@/lib/promptBuilder";

export type ProfilePromptKit = {
  template: string;
  resumeTemplateJson: string;
  jobDescription: string;
  output: string;
  updatedAt: string | null;
};

export const RESUME_BUILDER_STORAGE_KEYS = {
  selectedProfileId: "resumeBuilder_selectedProfileId",
  kitPrefix: "resumeBuilder_promptKit_v1_",
} as const;

export function emptyProfilePromptKit(
  overrides: Partial<ProfilePromptKit> = {},
): ProfilePromptKit {
  return {
    template: DEFAULT_PROMPT_TEMPLATE,
    resumeTemplateJson: "",
    jobDescription: "",
    output: "",
    updatedAt: null,
    ...overrides,
  };
}

export function promptKitStorageKey(profileId: number): string {
  return `${RESUME_BUILDER_STORAGE_KEYS.kitPrefix}${profileId}`;
}

export function readSelectedProfileId(
  storage: Pick<Storage, "getItem"> = globalThis.localStorage,
): number | null {
  try {
    const raw = storage.getItem(RESUME_BUILDER_STORAGE_KEYS.selectedProfileId);
    const id = Number(raw);
    return Number.isFinite(id) && id > 0 ? id : null;
  } catch {
    return null;
  }
}

export function writeSelectedProfileId(
  profileId: number | null,
  storage: Pick<Storage, "setItem" | "removeItem"> = globalThis.localStorage,
): void {
  try {
    if (profileId == null) {
      storage.removeItem(RESUME_BUILDER_STORAGE_KEYS.selectedProfileId);
      return;
    }
    storage.setItem(RESUME_BUILDER_STORAGE_KEYS.selectedProfileId, String(profileId));
  } catch {
    // ignore
  }
}

export function readProfilePromptKit(
  profileId: number,
  storage: Pick<Storage, "getItem"> = globalThis.localStorage,
): ProfilePromptKit {
  try {
    const raw = storage.getItem(promptKitStorageKey(profileId));
    if (!raw) return emptyProfilePromptKit();
    const parsed = JSON.parse(raw) as Partial<ProfilePromptKit>;
    return emptyProfilePromptKit({
      template:
        typeof parsed.template === "string" ? parsed.template : DEFAULT_PROMPT_TEMPLATE,
      resumeTemplateJson:
        typeof parsed.resumeTemplateJson === "string" ? parsed.resumeTemplateJson : "",
      jobDescription:
        typeof parsed.jobDescription === "string" ? parsed.jobDescription : "",
      output: typeof parsed.output === "string" ? parsed.output : "",
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : null,
    });
  } catch {
    return emptyProfilePromptKit();
  }
}

export function writeProfilePromptKit(
  profileId: number,
  kit: ProfilePromptKit,
  storage: Pick<Storage, "setItem"> = globalThis.localStorage,
  options: { touchUpdatedAt?: boolean } = {},
): ProfilePromptKit {
  const touchUpdatedAt = options.touchUpdatedAt !== false;
  const next: ProfilePromptKit = {
    template: kit.template ?? DEFAULT_PROMPT_TEMPLATE,
    resumeTemplateJson: kit.resumeTemplateJson ?? "",
    jobDescription: kit.jobDescription ?? "",
    output: kit.output ?? "",
    updatedAt: touchUpdatedAt
      ? new Date().toISOString()
      : (kit.updatedAt ?? new Date().toISOString()),
  };
  storage.setItem(promptKitStorageKey(profileId), JSON.stringify(next));
  return next;
}
