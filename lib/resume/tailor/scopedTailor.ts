import type { ResumeStructure } from "../structure/types";
import type { ResumeContent } from "../../resumeTemplates/types";
import type { TailorResumeResponse } from "../../resumeTailor";

/**
 * Scoped resume improvement - only edits allowed sections
 * 
 * ALLOWED TO EDIT:
 * - Profile/headline title
 * - Professional summary
 * - Technical skills section (reorder, normalize, improve ATS alignment)
 * - Work experience accomplishments (bullet points only)
 * 
 * PRESERVED AS-IS:
 * - Company names
 * - Employment dates
 * - Locations
 * - Role titles (except minor polish)
 * - Education
 * - Certifications
 * - Section order
 * - Formatting and layout
 */
export function applyScopedTailoring(
  structure: ResumeStructure,
  tailoredResponse: TailorResumeResponse,
  originalContent: ResumeContent
): ResumeContent {
  // Validate original content has required fields
  if (!originalContent.experience || !Array.isArray(originalContent.experience)) {
    throw new Error("Invalid original content: experience array is required");
  }

  // Start with original content - preserve everything by default
  const improvedContent: ResumeContent = {
    profileTitle: originalContent.profileTitle,
    professionalSummary: originalContent.professionalSummary || "",
    experience: originalContent.experience.map((exp) => ({
      ...exp,
      // Preserve original bullets - will be replaced only if tailored version exists
      bullets: Array.isArray(exp.bullets) ? [...exp.bullets] : [],
    })),
    contactInfo: originalContent.contactInfo,
    skills: originalContent.skills ? [...originalContent.skills] : undefined,
    education: originalContent.education ? [...originalContent.education] : undefined,
    certifications: originalContent.certifications ? [...originalContent.certifications] : undefined,
  };

  // Fail loudly if experience is empty after initialization
  if (improvedContent.experience.length === 0) {
    throw new Error("Critical: Resume experience section is empty. Experience parsing may have failed.");
  }

  // 1. ALLOWED: Improve profile title
  if (tailoredResponse.profile_title && tailoredResponse.profile_title.trim()) {
    improvedContent.profileTitle = tailoredResponse.profile_title.trim();
  }

  // 2. ALLOWED: Improve professional summary
  if (tailoredResponse.professional_summary && tailoredResponse.professional_summary.trim()) {
    improvedContent.professionalSummary = tailoredResponse.professional_summary.trim();
  }

  // 3. ALLOWED: Improve technical skills (reorder, normalize, optimize)
  if (tailoredResponse.skills_optimized && tailoredResponse.skills_optimized.length > 0) {
    // Use optimized skills if provided
    improvedContent.skills = tailoredResponse.skills_optimized;
  }
  // If no optimized skills provided, original skills are already preserved

  // 4. ALLOWED: Improve work experience accomplishments (bullets only)
  if (tailoredResponse.tailored_experience && originalContent.experience) {
    const originalJobs = originalContent.experience;
    const tailoredJobs = tailoredResponse.tailored_experience;

    // Create a map for matching
    const tailoredMap = new Map<string, typeof tailoredJobs[0]>();
    tailoredJobs.forEach((job) => {
      // Match by job title (case-insensitive, normalized)
      const key = job.job_title.toLowerCase().trim();
      tailoredMap.set(key, job);
    });

    // Apply improvements while preserving structure
    improvedContent.experience = originalJobs.map((originalJob) => {
      const key = originalJob.jobTitle.toLowerCase().trim();
      const tailored = tailoredMap.get(key);

      if (tailored) {
        // PRESERVE: Job title (only minor polish allowed, but we keep original for safety)
        // PRESERVE: Company name (never change)
        // IMPROVE: Bullet points only
        return {
          jobTitle: originalJob.jobTitle, // Preserve original
          company: originalJob.company, // Preserve original
          bullets: tailored.bullets.length > 0 
            ? tailored.bullets 
            : originalJob.bullets, // Use improved bullets if available
        };
      }

      // No match found - preserve original completely
      return originalJob;
    });
  }

  // All other sections (education, certifications, contact info) remain unchanged
  return improvedContent;
}
