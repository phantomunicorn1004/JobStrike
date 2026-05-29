import { parseResume } from "@/lib/resume/parseResume";
import { parseDOCXStructure } from "@/lib/resume/structure/docxParser";
import { inferStructureFromText, structureToContent } from "@/lib/resume/structure/infer";
import type { ResumeStructure } from "@/lib/resume/structure/types";
import type { ResumeContent } from "@/lib/resumeTemplates/types";

export async function parseResumeFromPublicUrl(resumeUrl: string) {
  const res = await fetch(resumeUrl);
  if (!res.ok) {
    throw new Error(`Failed to download resume (${res.status}).`);
  }

  const arrayBuffer = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const urlPath = new URL(resumeUrl).pathname;
  const fileName = urlPath.split("/").pop() || "resume.pdf";

  const blob = new Blob([new Uint8Array(buffer)]);
  const file = new File([blob], fileName, {
    type: res.headers.get("content-type") || "application/pdf",
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
