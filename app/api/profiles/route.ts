import { NextRequest } from "next/server";
import { corsJson, corsOptions } from "@/lib/api/extensionCors";
import { sanitizeProfileAutofill } from "@/lib/resume-db/profile-autofill";
import {
  requireRequestUser,
  resolveRequestUser,
  unauthorizedJson,
} from "@/lib/auth/resolve-request-user";
import {
  createProfile,
  listProfileRecords,
  listProfiles,
} from "@/lib/resume-db/repository";

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
    // Only when sent: an older client that omits it must not wipe saved answers.
    ...(body.autofill !== undefined ? { autofill: sanitizeProfileAutofill(body.autofill) } : {}),
  };
}

export async function GET(request: NextRequest) {
  try {
    const user = await resolveRequestUser(request);
    if (!user) {
      return corsJson(unauthorizedJson(), { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    if (searchParams.get("full") === "1") {
      const profiles = await listProfileRecords(user.id);
      return corsJson({ profiles });
    }

    const profiles = await listProfiles(user.id);
    return corsJson({ profiles });
  } catch (error) {
    console.error("Profiles list error:", error);
    const message = error instanceof Error ? error.message : "Failed to load profiles.";
    return corsJson({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireRequestUser(request);
    const body = await request.json();
    const profile = parseProfileBody(body);

    if (!profile.full_name) {
      return corsJson({ error: "Full name is required." }, { status: 400 });
    }

    const created = await createProfile(user.id, profile);
    // The row comes back without the column when the database predates it.
    const autofillSkipped = "autofill" in profile && created.autofill === undefined;
    return corsJson(
      {
        profile: created,
        ...(autofillSkipped
          ? { warning: "Autofill details were not saved. Run scripts/add-profile-autofill.sql on the database." }
          : {}),
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Profiles create error:", error);
    const message = error instanceof Error ? error.message : "Failed to create profile.";
    const status = message === "Unauthorized" ? 401 : 500;
    return corsJson({ error: message }, { status });
  }
}
