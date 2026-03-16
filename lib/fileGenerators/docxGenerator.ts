import {
  Document,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  TabStopType,
  TabStopPosition,
} from "docx";
import type { ResumeContent } from "../resumeTemplates/types";
import type { TemplateConfig } from "../resumeTemplates/types";

export function generateDOCXDocument(
  content: ResumeContent,
  templateConfig: TemplateConfig
): Document {
  const children: Paragraph[] = [];

  // Profile Title
  children.push(
    new Paragraph({
      text: content.profileTitle,
      heading: HeadingLevel.TITLE,
      spacing: { after: 200 },
    })
  );

  // Professional Summary
  if (content.professionalSummary) {
    children.push(
      new Paragraph({
        text: "PROFESSIONAL SUMMARY",
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 200, after: 100 },
      })
    );
    children.push(
      new Paragraph({
        text: content.professionalSummary,
        spacing: { after: 200 },
      })
    );
  }

  // Experience
  if (content.experience && content.experience.length > 0) {
    children.push(
      new Paragraph({
        text: "PROFESSIONAL EXPERIENCE",
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 200, after: 100 },
      })
    );

    content.experience.forEach((exp) => {
      // Job title and company
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: exp.jobTitle,
              bold: true,
              size: 24,
            }),
            new TextRun({
              text: " | ",
              size: 24,
            }),
            new TextRun({
              text: exp.company,
              italics: true,
              size: 24,
            }),
          ],
          spacing: { after: 100 },
        })
      );

      // Bullets
      exp.bullets.forEach((bullet) => {
        children.push(
          new Paragraph({
            children: [
              new TextRun({
                text: "• ",
                bold: true,
              }),
              new TextRun({
                text: bullet,
              }),
            ],
            spacing: { after: 100 },
            indent: { left: 400 },
          })
        );
      });

      children.push(
        new Paragraph({
          text: "",
          spacing: { after: 200 },
        })
      );
    });
  }

  // Skills
  if (content.skills && content.skills.length > 0) {
    children.push(
      new Paragraph({
        text: "TECHNICAL SKILLS",
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 200, after: 100 },
      })
    );
    children.push(
      new Paragraph({
        text: content.skills.join(" • "),
        spacing: { after: 200 },
      })
    );
  }

  // Education
  if (content.education && content.education.length > 0) {
    children.push(
      new Paragraph({
        text: "EDUCATION",
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 200, after: 100 },
      })
    );
    content.education.forEach((edu) => {
      children.push(
        new Paragraph({
          text: edu,
          spacing: { after: 100 },
        })
      );
    });
  }

  // Certifications
  if (content.certifications && content.certifications.length > 0) {
    children.push(
      new Paragraph({
        text: "CERTIFICATIONS",
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 200, after: 100 },
      })
    );
    content.certifications.forEach((cert) => {
      children.push(
        new Paragraph({
          text: cert,
          spacing: { after: 100 },
        })
      );
    });
  }

  return new Document({
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: 1440, // 1 inch in twips (20th of a point)
              right: 1440,
              bottom: 1440,
              left: 1440,
            },
          },
        },
        children: children,
      },
    ],
  });
}
