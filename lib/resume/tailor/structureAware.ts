import type { ResumeStructure } from "../structure/types";
import type { ResumeContent } from "../../resumeTemplates/types";
import type { TailorResumeResponse } from "../../resumeTailor";

/**
 * Map tailored AI response to structure-preserving content
 * Ensures tailored content aligns with original resume structure
 */
export function mapTailoredToStructure(
  structure: ResumeStructure,
  tailoredResponse: TailorResumeResponse,
  originalContent: ResumeContent
): ResumeContent {
  // Use tailored content, but preserve structure order
  const tailoredContent: ResumeContent = {
    profileTitle: tailoredResponse.profile_title || originalContent.profileTitle,
    professionalSummary: tailoredResponse.professional_summary || originalContent.professionalSummary,
    experience: tailoredResponse.tailored_experience || originalContent.experience,
    contactInfo: originalContent.contactInfo,
    skills: originalContent.skills,
    education: originalContent.education,
    certifications: originalContent.certifications,
  };

  // Ensure experience entries match original structure
  if (tailoredResponse.tailored_experience && originalContent.experience) {
    // Match tailored experience to original order
    const originalJobs = originalContent.experience;
    const tailoredJobs = tailoredResponse.tailored_experience;
    
    // Create a map of original job titles for matching
    const tailoredMap = new Map<string, typeof tailoredJobs[0]>();
    tailoredJobs.forEach((job) => {
      tailoredMap.set(job.job_title.toLowerCase(), job);
    });

    // Rebuild experience array preserving original order
    const matchedExperience = originalJobs.map((originalJob) => {
      const key = originalJob.jobTitle.toLowerCase();
      const tailored = tailoredMap.get(key);
      
      if (tailored) {
        return {
          jobTitle: tailored.job_title || originalJob.jobTitle,
          company: tailored.company || originalJob.company,
          bullets: tailored.bullets.length > 0 ? tailored.bullets : originalJob.bullets,
        };
      }
      
      // If no match, keep original
      return originalJob;
    });

    tailoredContent.experience = matchedExperience;
  }

  return tailoredContent;
}
