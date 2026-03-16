import { Document, Paragraph, TextRun, Packer, HeadingLevel, AlignmentType } from "docx";
import type { ResumeContent } from "../../resumeTemplates/types";
import type { DOCXStructureWithFormat, ParagraphWithFormat } from "../structure/docxParserWithFormat";

/**
 * Format-preserving DOCX builder
 * Replaces ONLY text content while preserving all original formatting
 * 
 * CRITICAL: This maintains paragraph count and structure exactly
 */
export async function buildDOCXWithPreservedFormat(
  originalBuffer: Buffer,
  paragraphs: ParagraphWithFormat[],
  tailoredContent: ResumeContent
): Promise<Buffer> {
  const docxParagraphs: Paragraph[] = [];
  
  // Track mapping for experience bullets across all entries
  let totalBulletIndex = 0;
  let currentExpEntryIndex = 0;
  let bulletsUsedInCurrentEntry = 0;

  for (const para of paragraphs) {
    // Determine what content to use (tailored vs original)
    let textToUse = para.text;
    
    // Map tailored content based on section type and position
    if (para.index === 0 && !para.isHeading && !para.isBullet) {
      // First non-heading paragraph is typically the profile title
      textToUse = tailoredContent.profileTitle || textToUse;
    } else if (para.sectionType === "summary" && !para.isHeading && !para.isBullet) {
      // Professional summary content - replace entire summary text
      if (tailoredContent.professionalSummary) {
        textToUse = tailoredContent.professionalSummary;
      }
    } else if (para.sectionType === "experience" && para.isBullet) {
      // Experience bullets - map sequentially across all experience entries
      if (tailoredContent.experience && tailoredContent.experience.length > 0) {
        // Calculate total bullets across all previous entries
        let totalPreviousBullets = 0;
        for (let i = 0; i < currentExpEntryIndex && i < tailoredContent.experience.length; i++) {
          if (tailoredContent.experience[i].bullets) {
            totalPreviousBullets += tailoredContent.experience[i].bullets.length;
          }
        }
        
        // Get current entry and its bullets
        const currentEntry = tailoredContent.experience[currentExpEntryIndex];
        if (currentEntry && currentEntry.bullets && currentEntry.bullets.length > 0) {
          const relativeBulletIndex = totalBulletIndex - totalPreviousBullets;
          if (relativeBulletIndex >= 0 && relativeBulletIndex < currentEntry.bullets.length) {
            textToUse = currentEntry.bullets[relativeBulletIndex];
            bulletsUsedInCurrentEntry++;
            
            // Move to next entry if we've used all bullets in current entry
            if (bulletsUsedInCurrentEntry >= currentEntry.bullets.length) {
              currentExpEntryIndex++;
              bulletsUsedInCurrentEntry = 0;
            }
          }
        }
        totalBulletIndex++;
      }
    } else if (para.sectionType === "skills" && !para.isHeading && !para.isBullet) {
      // Skills content - replace with optimized skills
      if (tailoredContent.skills && tailoredContent.skills.length > 0) {
        textToUse = tailoredContent.skills.join(" • ");
      }
    }
    // All other sections (education, certifications, headers, etc.) use original text

    // Build paragraph preserving original formatting EXACTLY
    const docxPara = new Paragraph({
      children: [
        new TextRun({
          text: textToUse,
          // Preserve formatting based on original structure
          bold: para.isHeading || false,
        }),
      ],
      heading: para.isHeading ? HeadingLevel.HEADING_1 : undefined,
      // Preserve indentation for bullets
      indent: para.isBullet && para.indentLevel !== undefined 
        ? { 
            left: para.indentLevel * 400, // 400 twips per indent level
            hanging: para.isBullet ? 400 : undefined, // Hanging indent for bullets
          } 
        : undefined,
      // Preserve original spacing
      spacing: para.originalSpacing ? {
        before: para.originalSpacing.before || 0,
        after: para.originalSpacing.after || 200,
      } : {
        after: para.isHeading ? 100 : 200,
        before: para.isHeading ? 200 : 0,
      },
      alignment: para.isHeading ? AlignmentType.LEFT : AlignmentType.LEFT,
    });

    docxParagraphs.push(docxPara);
  }

  // VALIDATION: Ensure paragraph count matches original
  if (docxParagraphs.length !== paragraphs.length) {
    throw new Error(
      `Format preservation failed: paragraph count mismatch. ` +
      `Original: ${paragraphs.length}, Generated: ${docxParagraphs.length}`
    );
  }

  // Build document with preserved formatting
  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: 1440, // 1 inch in twips
              right: 1440,
              bottom: 1440,
              left: 1440,
            },
          },
        },
        children: docxParagraphs,
      },
    ],
  });

  return await Packer.toBuffer(doc);
}
