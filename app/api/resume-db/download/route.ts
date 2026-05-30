import { NextRequest, NextResponse } from "next/server";
import { requireRequestUser } from "@/lib/auth/resolve-request-user";
import { downloadFileFromUrl } from "@/lib/resume-db/downloadFile";
import { getApplicationById } from "@/lib/resume-db/repository";

function encodeContentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7E]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireRequestUser(request);
    const { searchParams } = new URL(request.url);
    const idParam = searchParams.get("id");
    const kind = searchParams.get("kind") === "cover" ? "cover" : "resume";

    if (!idParam) {
      return NextResponse.json({ error: "Missing query parameter: id" }, { status: 400 });
    }

    const id = Number(idParam);
    if (Number.isNaN(id) || id < 1) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const app = await getApplicationById(id, user.id);
    if (!app) {
      return NextResponse.json({ error: "Application not found." }, { status: 404 });
    }

    const fileUrl = kind === "cover" ? app.coverLetterUrl : app.resumeUrl;
    const storagePath =
      kind === "cover" ? app.coverLetterStoragePath : app.resumeStoragePath;

    if (!fileUrl?.trim() && !storagePath?.trim()) {
      return NextResponse.json({ error: "No file available for this row." }, { status: 404 });
    }

    const fallbackName =
      kind === "cover"
        ? `${app.company || "cover"}-cover-letter.docx`
        : `${app.company || "resume"}-resume.docx`;

    const { buffer, fileName, contentType } = await downloadFileFromUrl(
      fileUrl,
      fallbackName,
      storagePath,
    );

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": encodeContentDisposition(fileName),
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    console.error("Resume DB download error:", error);
    const message = error instanceof Error ? error.message : "Download failed.";
    const status = message === "Unauthorized" ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
