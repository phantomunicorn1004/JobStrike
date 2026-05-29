import { isGoogleDriveConfigured } from "@/lib/google-drive/config";
import { downloadDriveFile } from "@/lib/google-drive/upload";
import {
  extractGoogleDriveFileId,
  googleDriveDirectDownloadUrl,
} from "@/lib/google-drive/urls";
import { parseResume } from "@/lib/resume/parseResume";
import { parseDOCXStructure } from "@/lib/resume/structure/docxParser";
import { inferStructureFromText, structureToContent } from "@/lib/resume/structure/infer";
import type { ResumeStructure } from "@/lib/resume/structure/types";
import type { ResumeContent } from "@/lib/resumeTemplates/types";

async function fetchResumeBytes(
  resumeUrl: string,
): Promise<{ buffer: Buffer; fileName: string; contentType: string }> {
  const driveId = extractGoogleDriveFileId(resumeUrl);

  if (driveId && isGoogleDriveConfigured()) {
    const fromDrive = await downloadDriveFile(driveId);
    return {
      buffer: fromDrive.buffer,
      fileName: fromDrive.name,
      contentType: fromDrive.mimeType,
    };
  }

  const fetchUrl = driveId
    ? googleDriveDirectDownloadUrl(driveId)
    : resumeUrl;

  const res = await fetch(fetchUrl, { redirect: "follow" });
  if (!res.ok) {
    throw new Error(
      `Failed to download resume (${res.status}). For Google Drive links, ensure the file is shared and Drive is configured on the server.`,
    );
  }

  const arrayBuffer = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  let fileName = "resume.pdf";
  try {
    const urlPath = new URL(resumeUrl).pathname;
    const segment = urlPath.split("/").pop();
    if (segment && segment.length < 120) fileName = decodeURIComponent(segment);
  } catch {
    /* keep default */
  }

  return {
    buffer,
    fileName,
    contentType: res.headers.get("content-type") || "application/pdf",
  };
}

export async function parseResumeFromPublicUrl(resumeUrl: string) {
  const { buffer, fileName, contentType } = await fetchResumeBytes(resumeUrl);

  const blob = new Blob([new Uint8Array(buffer)]);
  const file = new File([blob], fileName, {
    type: contentType,
  });

  const parseResult = await parseResume(file, { maxFileSize: 10 * 1024 * 1024 });

  let structure: ResumeStructure;
  let content: ResumeContent;

  if (parseResult.fileType === "docx") {
    const docxStructure = await parseDOCXStructure(buffer);
    structure = docxStructure.structure;
    const contentFromStructure = structureToContent(structure);
    content = {
      profileTitle: contentFromStructure.profileTitle,
      professionalSummary: contentFromStructure.professionalSummary ?? "",
      experience: contentFromStructure.experience,
      contactInfo: contentFromStructure.contactInfo,
      skills: contentFromStructure.skills,
      education: contentFromStructure.education,
      certifications: contentFromStructure.certifications,
    };
  } else {
    structure = inferStructureFromText(parseResult.text);
    const contentFromStructure = structureToContent(structure);
    content = {
      profileTitle: contentFromStructure.profileTitle,
      professionalSummary: contentFromStructure.professionalSummary ?? "",
      experience: contentFromStructure.experience,
      contactInfo: contentFromStructure.contactInfo,
      skills: contentFromStructure.skills,
      education: contentFromStructure.education,
      certifications: contentFromStructure.certifications,
    };
    structure.originalFormat = { fileType: "pdf" };
  }

  return { content, structure, fileName, fileType: parseResult.fileType };
}
