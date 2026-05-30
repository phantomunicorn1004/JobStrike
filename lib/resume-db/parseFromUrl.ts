import { downloadFileFromUrl } from "@/lib/resume-db/downloadFile";
import { parseResume } from "@/lib/resume/parseResume";
import { parseDOCXStructure } from "@/lib/resume/structure/docxParser";
import { inferStructureFromText, structureToContent } from "@/lib/resume/structure/infer";
import type { ResumeStructure } from "@/lib/resume/structure/types";
import type { ResumeContent } from "@/lib/resumeTemplates/types";

export async function parseResumeFromPublicUrl(resumeUrl: string) {
  const { buffer, fileName, contentType } = await downloadFileFromUrl(
    resumeUrl,
    "resume.pdf",
  );

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
