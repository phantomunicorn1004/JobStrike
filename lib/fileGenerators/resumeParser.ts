import type { ResumeContent } from "../resumeTemplates/types";

/**
 * Parses plain text resume into structured ResumeContent
 */
export function parseResumeText(resumeText: string): ResumeContent {
  const lines = resumeText.split("\n");
  const content: ResumeContent = {
    profileTitle: "",
    professionalSummary: "",
    experience: [],
  };

  let currentSection = "";
  let currentJob: { jobTitle: string; company: string; bullets: string[] } | null = null;
  const contactInfo: string[] = [];
  const skills: string[] = [];
  const education: string[] = [];
  const certifications: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const upperLine = line.toUpperCase();

    // Detect sections
    if (upperLine.includes("PROFESSIONAL SUMMARY") || upperLine.includes("SUMMARY")) {
      currentSection = "summary";
      continue;
    } else if (upperLine.includes("EXPERIENCE") || upperLine.includes("WORK EXPERIENCE")) {
      currentSection = "experience";
      if (currentJob) {
        content.experience.push(currentJob);
        currentJob = null;
      }
      continue;
    } else if (upperLine.includes("SKILL") || upperLine.includes("TECHNICAL")) {
      currentSection = "skills";
      continue;
    } else if (upperLine.includes("EDUCATION")) {
      currentSection = "education";
      continue;
    } else if (upperLine.includes("CERTIFICATION")) {
      currentSection = "certification";
      continue;
    }

    // Process content based on current section
    if (currentSection === "") {
      // Before any section - likely contact info or title
      if (line && !line.includes("EMAIL") && !line.includes("PHONE") && !line.includes("@")) {
        if (!content.profileTitle) {
          content.profileTitle = line;
        }
      }
      if (line.includes("EMAIL") || line.includes("PHONE") || line.includes("@")) {
        contactInfo.push(line);
      }
    } else if (currentSection === "summary") {
      if (line && !upperLine.includes("SUMMARY")) {
        content.professionalSummary +=
          (content.professionalSummary ? "\n" : "") + line;
      }
    } else if (currentSection === "experience") {
      // Check if line contains job title and company (usually separated by |)
      if (line.includes("|")) {
        if (currentJob) {
          content.experience.push(currentJob);
        }
        const parts = line.split("|").map((p) => p.trim());
        currentJob = {
          jobTitle: parts[0] || "",
          company: parts[1] || "",
          bullets: [],
        };
      } else if ((line.startsWith("•") || line.startsWith("-")) && currentJob) {
        currentJob.bullets.push(line.replace(/^[•\-]\s*/, ""));
      }
    } else if (currentSection === "skills" && line) {
      skills.push(line);
    } else if (currentSection === "education" && line) {
      education.push(line);
    } else if (currentSection === "certification" && line) {
      certifications.push(line);
    }
  }

  // Add last job if exists
  if (currentJob) {
    content.experience.push(currentJob);
  }

  // Add optional sections
  if (contactInfo.length > 0) {
    content.contactInfo = contactInfo.join("\n");
  }
  if (skills.length > 0) {
    content.skills = skills;
  }
  if (education.length > 0) {
    content.education = education;
  }
  if (certifications.length > 0) {
    content.certifications = certifications;
  }

  return content;
}
