import type { ResumeStructure, ResumeSection, SectionType } from "./types";

/**
 * Infer resume structure from plain text
 * Identifies sections, headings, and content organization
 */
export function inferStructureFromText(text: string): ResumeStructure {
  const lines = text.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
  const sections: ResumeSection[] = [];
  
  let currentSection: ResumeSection | null = null;
  let sectionOrder = 0;
  let headerContent: string[] = [];
  let contactInfo: string[] = [];

  // Common section headers to detect
  const sectionPatterns: Record<string, SectionType> = {
    "professional summary": "summary",
    "summary": "summary",
    "executive summary": "summary",
    "objective": "summary",
    "experience": "experience",
    "work experience": "experience",
    "employment": "experience",
    "professional experience": "experience",
    "work history": "experience",
    "skills": "skills",
    "technical skills": "skills",
    "core competencies": "skills",
    "education": "education",
    "academic background": "education",
    "certifications": "certifications",
    "certificates": "certifications",
    "licenses": "certifications",
  };

  let isInHeader = true;
  let foundFirstSection = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const upperLine = line.toUpperCase();

    // Check if this is a section header
    let detectedSection: SectionType | null = null;
    for (const [pattern, sectionType] of Object.entries(sectionPatterns)) {
      if (upperLine.includes(pattern.toUpperCase()) && upperLine.length < 50) {
        detectedSection = sectionType;
        break;
      }
    }

    if (detectedSection) {
      // Save previous section
      if (currentSection) {
        sections.push(currentSection);
      }

      // Start new section
      foundFirstSection = true;
      isInHeader = false;
      currentSection = {
        type: detectedSection,
        title: line,
        content: [],
        order: sectionOrder++,
        metadata: {
          isHeading: true,
        },
      };
    } else if (foundFirstSection && currentSection) {
      // Add content to current section
      const isBullet = line.startsWith("•") || line.startsWith("-") || line.startsWith("*");
      if (!currentSection.metadata) {
        currentSection.metadata = {};
      }
      if (isBullet) {
        currentSection.metadata.isBulletList = true;
        currentSection.content.push(line.replace(/^[•\-\*]\s*/, ""));
      } else {
        currentSection.content.push(line);
      }
    } else if (isInHeader) {
      // Header content (before first section)
      if (line.includes("@") || line.includes("email") || line.includes("phone") || line.match(/\d{3}[-.]?\d{3}[-.]?\d{4}/)) {
        contactInfo.push(line);
      } else {
        headerContent.push(line);
      }
    }
  }

  // Add last section
  if (currentSection) {
    sections.push(currentSection);
  }

  return {
    header: {
      title: headerContent[0] || "",
      contactInfo: contactInfo.length > 0 ? contactInfo : undefined,
    },
    sections,
  };
}

/**
 * Map structure to structured content format
 */
export function structureToContent(structure: ResumeStructure): {
  profileTitle: string;
  contactInfo?: string;
  professionalSummary?: string;
  experience: Array<{ jobTitle: string; company: string; bullets: string[] }>;
  skills?: string[];
  education?: string[];
  certifications?: string[];
} {
  const result = {
    profileTitle: structure.header.title || "",
    contactInfo: structure.header.contactInfo?.join("\n"),
    experience: [] as Array<{ jobTitle: string; company: string; bullets: string[] }>,
    skills: [] as string[],
    education: [] as string[],
    certifications: [] as string[],
  };

  // Process sections
  for (const section of structure.sections) {
    if (section.type === "summary") {
      result.professionalSummary = section.content.join("\n");
    } else if (section.type === "experience") {
      // Parse experience entries
      // Support multiple formats:
      // 1. "Job Title | Company"
      // 2. "Job Title at Company"
      // 3. "Job Title - Company"
      // 4. Lines starting with job titles (detected by capital case patterns)
      let currentJob: { jobTitle: string; company: string; bullets: string[] } | null = null;
      
      for (const line of section.content) {
        const trimmedLine = line.trim();
        if (!trimmedLine) continue;
        
        // Check if line contains job title and company (multiple separators supported)
        const hasSeparator = trimmedLine.includes("|") || 
                            trimmedLine.match(/\s+at\s+/i) || 
                            trimmedLine.includes(" - ") ||
                            trimmedLine.match(/^[A-Z][^|]+[-–—]\s*[A-Z]/); // Title - Company format
        
        if (hasSeparator) {
          // Save previous job if exists
          if (currentJob && (currentJob.jobTitle || currentJob.company)) {
            result.experience.push(currentJob);
          }
          
          // Extract job title and company
          const parts = trimmedLine
            .split(/[|]|\s+at\s+|\s*[-–—]\s*/i)
            .map((p) => p.trim())
            .filter((p) => p.length > 0);
          
          if (parts.length >= 1) {
            currentJob = {
              jobTitle: parts[0] || "",
              company: parts[1] || parts[0] || "", // If only one part, use as both
              bullets: [],
            };
          }
        } else if (currentJob) {
          // This is a bullet point for the current job
          if (trimmedLine.match(/^[•\-\*]\s*/) || trimmedLine.length > 10) {
            // Remove bullet markers
            const bulletText = trimmedLine.replace(/^[•\-\*]\s*/, "").trim();
            if (bulletText) {
              currentJob.bullets.push(bulletText);
            }
          } else if (trimmedLine.length > 3) {
            // Assume it's a bullet even without marker if it's substantial text
            currentJob.bullets.push(trimmedLine);
          }
        } else {
          // No current job but we have a line - might be a job title without separator
          // Try to detect if it looks like a job title (capitalized, reasonable length)
          if (trimmedLine.length > 5 && trimmedLine.length < 80 && 
              trimmedLine[0] === trimmedLine[0].toUpperCase() &&
              !trimmedLine.match(/^[•\-\*]/)) {
            // Start a new job entry
            currentJob = {
              jobTitle: trimmedLine,
              company: "",
              bullets: [],
            };
          }
        }
      }
      
      // Don't forget the last job
      if (currentJob && (currentJob.jobTitle || currentJob.company)) {
        result.experience.push(currentJob);
      }
    } else if (section.type === "skills") {
      result.skills = section.content.flatMap((line) => {
        // Split by common delimiters
        return line
          .split(/[•,;|]/)
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
      });
    } else if (section.type === "education") {
      result.education = section.content;
    } else if (section.type === "certifications") {
      result.certifications = section.content;
    }
  }

  return result;
}
