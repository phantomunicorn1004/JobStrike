import { NextRequest } from "next/server";
import { corsJson, corsOptions } from "@/lib/api/extensionCors";
import { requireRequestUser } from "@/lib/auth/resolve-request-user";
import { deleteProfile, updateProfile } from "@/lib/resume-db/repository";

export function OPTIONS() {
  return corsOptions();
}

function parseProfileBody(body: Record<string, unknown>) {
  const workEmailsRaw = body.work_emails ?? body.workEmails;
  const phoneNumbersRaw = body.phone_numbers ?? body.phoneNumbers;
  const work_emails = Array.isArray(workEmailsRaw)
    ? workEmailsRaw.map(String)
    : String(workEmailsRaw ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
  const phone_numbers = Array.isArray(phoneNumbersRaw)
    ? phoneNumbersRaw.map(String)
    : String(phoneNumbersRaw ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

  return {
    full_name: String(body.full_name ?? body.fullName ?? "").trim(),
    dob: String(body.dob ?? "").trim(),
    work_emails,
    phone_numbers,
    ssn: String(body.ssn ?? "").trim(),
    address: String(body.address ?? "").trim(),
    city: String(body.city ?? "").trim(),
    state: String(body.state ?? "").trim(),
    postal_code: String(body.postal_code ?? body.postalCode ?? "").trim(),
    university: String(body.university ?? "").trim(),
    linkedin: String(body.linkedin ?? "").trim(),
  };
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireRequestUser(request);
    const { id: idParam } = await context.params;
    const profileId = Number(idParam);
    if (Number.isNaN(profileId) || profileId < 1) {
      return corsJson({ error: "Invalid profile id" }, { status: 400 });
    }

    const body = await request.json();
    const profile = parseProfileBody(body);
    await updateProfile(user.id, profileId, profile);
    return corsJson({ ok: true });
  } catch (error) {
    console.error("Profiles update error:", error);
    const message = error instanceof Error ? error.message : "Failed to update profile.";
    const status = message === "Unauthorized" ? 401 : 500;
    return corsJson({ error: message }, { status });
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireRequestUser(request);
    const { id: idParam } = await context.params;
    const profileId = Number(idParam);
    if (Number.isNaN(profileId) || profileId < 1) {
      return corsJson({ error: "Invalid profile id" }, { status: 400 });
    }

    await deleteProfile(user.id, profileId);
    return corsJson({ ok: true });
  } catch (error) {
    console.error("Profiles delete error:", error);
    const message = error instanceof Error ? error.message : "Failed to delete profile.";
    const status = message === "Unauthorized" ? 401 : 500;
    return corsJson({ error: message }, { status });
  }
}
