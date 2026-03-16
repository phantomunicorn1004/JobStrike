"use client";

import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Loader2, Plus, Trash2, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";

type TailoredResumeData = {
  profileTitle: string;
  professionalSummary: string;
  experience: Array<{
    jobTitle: string;
    company: string;
    bullets: string[];
  }>;
};

type StepTailorResumeProps = {
  data: {
    jobTitle: string;
    jobDescription: string;
    resumeFileName: string;
    resumeText: string;
    tailoredResume: string;
    isTailored: boolean;
    atsKeywords?: {
      technical_skills: string[];
      tools_and_technologies: string[];
      job_responsibilities: string[];
      industry_terms: string[];
    };
    atsScore: number | null;
  };
  updateData: (updates: Partial<any>) => void;
};

export function StepTailorResume({ data, updateData }: StepTailorResumeProps) {
  const [isTailoring, setIsTailoring] = useState(false);
  const [resumeData, setResumeData] = useState<TailoredResumeData>({
    profileTitle: "",
    professionalSummary: "",
    experience: [],
  });

  // Parse tailored resume into structured data
  useEffect(() => {
    if (data.tailoredResume && data.isTailored) {
      parseResumeToStructured(data.tailoredResume);
    }
  }, [data.tailoredResume, data.isTailored]);

  const parseResumeToStructured = (resumeText: string) => {
    const lines = resumeText.split("\n");
    let profileTitle = "";
    let professionalSummary = "";
    const experience: Array<{ jobTitle: string; company: string; bullets: string[] }> = [];
    
    let currentSection = "";
    let currentJob: { jobTitle: string; company: string; bullets: string[] } | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      const upperLine = line.toUpperCase();

      if (upperLine.includes("PROFESSIONAL SUMMARY")) {
        currentSection = "summary";
        continue;
      } else if (upperLine.includes("EXPERIENCE") || upperLine.includes("WORK EXPERIENCE")) {
        currentSection = "experience";
        continue;
      }

      if (currentSection === "") {
        // Before any section, first non-empty line is likely profile title
        if (line && !line.includes("EMAIL") && !line.includes("PHONE") && !line.includes("@")) {
          if (!profileTitle) {
            profileTitle = line;
          }
        }
      } else if (currentSection === "summary") {
        if (line && !upperLine.includes("SUMMARY")) {
          professionalSummary += (professionalSummary ? "\n" : "") + line;
        }
      } else if (currentSection === "experience") {
        // Check if line contains job title and company (usually separated by |)
        if (line.includes("|")) {
          if (currentJob) {
            experience.push(currentJob);
          }
          const parts = line.split("|").map(p => p.trim());
          currentJob = {
            jobTitle: parts[0] || "",
            company: parts[1] || "",
            bullets: [],
          };
        } else if (line.startsWith("•") || line.startsWith("-")) {
          if (currentJob) {
            currentJob.bullets.push(line.replace(/^[•\-]\s*/, ""));
          }
        }
      }
    }

    if (currentJob) {
      experience.push(currentJob);
    }

    setResumeData({
      profileTitle: profileTitle || data.jobTitle || "",
      professionalSummary: professionalSummary || "",
      experience: experience.length > 0 ? experience : [],
    });
  };

  const handleTailorResume = async () => {
    if (!data.jobTitle || !data.jobDescription || !data.resumeText) {
      toast.error("Missing required information. Please complete previous steps.");
      return;
    }

    setIsTailoring(true);
    toast.info("Tailoring your resume with OpenAI...");

    try {
      const response = await fetch("/api/resume-tailor", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          jobTitle: data.jobTitle,
          jobDescription: data.jobDescription,
          resumeText: data.resumeText,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        const errorMessage = errorData.error || "Failed to tailor resume";
        
        // Provide user-friendly error messages
        if (response.status === 403) {
          throw new Error(
            errorMessage.includes("region") 
              ? errorMessage 
              : "Access denied. Please check your API configuration or contact support."
          );
        }
        
        throw new Error(errorMessage);
      }

      const result = await response.json();

      // Format the tailored resume
      const formattedResume = formatTailoredResume(
        result.profile_title,
        result.professional_summary,
        result.tailored_experience,
        data.resumeText
      );

      updateData({
        tailoredResume: formattedResume,
        isTailored: true,
        atsKeywords: result.ats_keywords,
      });

      // Parse and set structured data
      parseResumeToStructured(formattedResume);
      
      toast.success("Resume tailored successfully!");
    } catch (error) {
      console.error("Error tailoring resume:", error);
      
      let errorMessage = "Failed to tailor resume. Please try again.";
      if (error instanceof Error) {
        errorMessage = error.message;
        
        // Show more helpful messages for specific errors
        if (error.message.includes("region") || error.message.includes("not available")) {
          errorMessage = "OpenAI API is not available in your region. Please configure a proxy or use an alternative service.";
        }
      }
      
      toast.error(errorMessage, {
        duration: 6000, // Show longer for important errors
      });
    } finally {
      setIsTailoring(false);
    }
  };

  const formatTailoredResume = (
    profileTitle: string,
    professionalSummary: string,
    tailoredExperience: Array<{ job_title: string; company: string; bullets: string[] }>,
    originalResumeText: string
  ): string => {
    const lines = originalResumeText.split("\n");
    const contactInfo: string[] = [];
    const education: string[] = [];
    const certifications: string[] = [];
    const skills: string[] = [];
    
    let currentSection = "";
    for (const line of lines) {
      const upperLine = line.toUpperCase().trim();
      if (upperLine.includes("EMAIL") || upperLine.includes("PHONE") || upperLine.includes("@")) {
        contactInfo.push(line);
      } else if (upperLine.includes("EDUCATION")) {
        currentSection = "education";
        education.push(line);
      } else if (upperLine.includes("CERTIFICATION")) {
        currentSection = "certification";
        certifications.push(line);
      } else if (upperLine.includes("SKILL") || upperLine.includes("TECHNICAL")) {
        currentSection = "skills";
        skills.push(line);
      } else if (currentSection === "education" && line.trim()) {
        education.push(line);
      } else if (currentSection === "certification" && line.trim()) {
        certifications.push(line);
      } else if (currentSection === "skills" && line.trim()) {
        skills.push(line);
      }
    }

    let formatted = "";
    if (contactInfo.length > 0) {
      formatted += contactInfo.join("\n") + "\n\n";
    }
    formatted += `${profileTitle}\n\n`;
    formatted += `PROFESSIONAL SUMMARY\n${professionalSummary}\n\n`;
    if (skills.length > 0) {
      formatted += skills.join("\n") + "\n\n";
    }
    formatted += "PROFESSIONAL EXPERIENCE\n";
    for (const exp of tailoredExperience) {
      formatted += `${exp.job_title} | ${exp.company}\n`;
      for (const bullet of exp.bullets) {
        formatted += `• ${bullet}\n`;
      }
      formatted += "\n";
    }
    if (education.length > 0) {
      formatted += education.join("\n") + "\n\n";
    }
    if (certifications.length > 0) {
      formatted += certifications.join("\n");
    }
    return formatted.trim();
  };

  const handleSaveResume = () => {
    // Reconstruct resume from structured data
    const formattedResume = formatResumeFromStructured(resumeData, data.resumeText);
    updateData({
      tailoredResume: formattedResume,
      isTailored: true,
    });
    toast.success("Resume saved successfully");
  };

  const formatResumeFromStructured = (
    resumeData: TailoredResumeData,
    originalResumeText: string
  ): string => {
    const lines = originalResumeText.split("\n");
    const contactInfo: string[] = [];
    const education: string[] = [];
    const certifications: string[] = [];
    const skills: string[] = [];
    
    let currentSection = "";
    for (const line of lines) {
      const upperLine = line.toUpperCase().trim();
      if (upperLine.includes("EMAIL") || upperLine.includes("PHONE") || upperLine.includes("@")) {
        contactInfo.push(line);
      } else if (upperLine.includes("EDUCATION")) {
        currentSection = "education";
        education.push(line);
      } else if (upperLine.includes("CERTIFICATION")) {
        currentSection = "certification";
        certifications.push(line);
      } else if (upperLine.includes("SKILL") || upperLine.includes("TECHNICAL")) {
        currentSection = "skills";
        skills.push(line);
      } else if (currentSection === "education" && line.trim()) {
        education.push(line);
      } else if (currentSection === "certification" && line.trim()) {
        certifications.push(line);
      } else if (currentSection === "skills" && line.trim()) {
        skills.push(line);
      }
    }

    let formatted = "";
    if (contactInfo.length > 0) {
      formatted += contactInfo.join("\n") + "\n\n";
    }
    formatted += `${resumeData.profileTitle}\n\n`;
    formatted += `PROFESSIONAL SUMMARY\n${resumeData.professionalSummary}\n\n`;
    if (skills.length > 0) {
      formatted += skills.join("\n") + "\n\n";
    }
    formatted += "PROFESSIONAL EXPERIENCE\n";
    for (const exp of resumeData.experience) {
      formatted += `${exp.jobTitle} | ${exp.company}\n`;
      for (const bullet of exp.bullets) {
        formatted += `• ${bullet}\n`;
      }
      formatted += "\n";
    }
    if (education.length > 0) {
      formatted += education.join("\n") + "\n\n";
    }
    if (certifications.length > 0) {
      formatted += certifications.join("\n");
    }
    return formatted.trim();
  };

  const handleAddBullet = (jobIndex: number) => {
    setResumeData((prev) => ({
      ...prev,
      experience: prev.experience.map((exp, idx) =>
        idx === jobIndex
          ? { ...exp, bullets: [...exp.bullets, ""] }
          : exp
      ),
    }));
  };

  const handleRemoveBullet = (jobIndex: number, bulletIndex: number) => {
    setResumeData((prev) => ({
      ...prev,
      experience: prev.experience.map((exp, idx) =>
        idx === jobIndex
          ? { ...exp, bullets: exp.bullets.filter((_, bi) => bi !== bulletIndex) }
          : exp
      ),
    }));
  };

  const handleUpdateBullet = (jobIndex: number, bulletIndex: number, value: string) => {
    setResumeData((prev) => ({
      ...prev,
      experience: prev.experience.map((exp, idx) =>
        idx === jobIndex
          ? {
              ...exp,
              bullets: exp.bullets.map((bullet, bi) =>
                bi === bulletIndex ? value : bullet
              ),
            }
          : exp
      ),
    }));
  };

  const handleRunATSCheck = async () => {
    // Save current edits first
    handleSaveResume();
    
    // Trigger ATS check
    if (!data.jobTitle || !data.jobDescription) {
      toast.error("Missing required information for ATS check.");
      return;
    }

    toast.info("Running ATS check...");

    try {
      const response = await fetch("/api/ats-check", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          jobTitle: data.jobTitle,
          jobDescription: data.jobDescription,
          tailoredResumeText: formatResumeFromStructured(resumeData, data.resumeText),
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to check ATS compatibility");
      }

      const result = await response.json();

      updateData({
        atsScore: result.ats_score,
        matchedKeywords: result.matched_keywords || [],
        missingKeywords: result.missing_keywords || [],
        weakKeywords: result.weak_keywords || [],
        recommendations: result.recommendations || [],
      });

      toast.success("ATS check completed! You can now proceed to view results.");
    } catch (error) {
      console.error("Error checking ATS:", error);
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to check ATS compatibility. Please try again."
      );
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold mb-4">Tailored Resume Review</h2>
        <p className="text-sm text-muted-foreground mb-6">
          Review and edit your tailored resume. Make adjustments as needed before running ATS check.
        </p>
      </div>

      {!data.isTailored ? (
        <div className="space-y-4">
          <Button
            onClick={handleTailorResume}
            disabled={isTailoring}
            className="w-full"
            size="lg"
          >
            {isTailoring ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Tailoring Resume...
              </>
            ) : (
              "Tailor Resume"
            )}
          </Button>

          {isTailoring && (
            <div className="border rounded-lg p-4 bg-muted/50 min-h-[400px] space-y-3">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-4 w-2/3" />
              <div className="pt-4 space-y-2">
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-5/6" />
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Resume Editing Area */}
          <div className="lg:col-span-2 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Profile Title</CardTitle>
              </CardHeader>
              <CardContent>
                <Input
                  value={resumeData.profileTitle}
                  onChange={(e) =>
                    setResumeData((prev) => ({
                      ...prev,
                      profileTitle: e.target.value,
                    }))
                  }
                  placeholder="e.g., Senior Software Engineer"
                  className="text-lg font-semibold"
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Professional Summary</CardTitle>
              </CardHeader>
              <CardContent>
                <Textarea
                  value={resumeData.professionalSummary}
                  onChange={(e) =>
                    setResumeData((prev) => ({
                      ...prev,
                      professionalSummary: e.target.value,
                    }))
                  }
                  placeholder="Write a concise professional summary..."
                  className="min-h-[120px]"
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Experience</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                {resumeData.experience.length > 0 ? (
                  resumeData.experience.map((exp, jobIndex) => (
                    <div key={jobIndex} className="space-y-3">
                      <div className="flex gap-2">
                        <Input
                          value={exp.jobTitle}
                          onChange={(e) =>
                            setResumeData((prev) => ({
                              ...prev,
                              experience: prev.experience.map((exp, idx) =>
                                idx === jobIndex
                                  ? { ...exp, jobTitle: e.target.value }
                                  : exp
                              ),
                            }))
                          }
                          placeholder="Job Title"
                          className="flex-1"
                        />
                        <Input
                          value={exp.company}
                          onChange={(e) =>
                            setResumeData((prev) => ({
                              ...prev,
                              experience: prev.experience.map((exp, idx) =>
                                idx === jobIndex
                                  ? { ...exp, company: e.target.value }
                                  : exp
                              ),
                            }))
                          }
                          placeholder="Company"
                          className="flex-1"
                        />
                      </div>
                      <div className="space-y-2">
                        {exp.bullets.map((bullet, bulletIndex) => (
                          <div key={bulletIndex} className="flex gap-2">
                            <Textarea
                              value={bullet}
                              onChange={(e) =>
                                handleUpdateBullet(jobIndex, bulletIndex, e.target.value)
                              }
                              placeholder="Bullet point..."
                              className="flex-1 min-h-[60px]"
                            />
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleRemoveBullet(jobIndex, bulletIndex)}
                              className="shrink-0"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        ))}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleAddBullet(jobIndex)}
                          className="w-full"
                        >
                          <Plus className="h-4 w-4 mr-2" />
                          Add Bullet
                        </Button>
                      </div>
                      {jobIndex < resumeData.experience.length - 1 && (
                        <Separator className="my-4" />
                      )}
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No experience entries yet. Resume will be tailored with experience from your original resume.
                  </p>
                )}
              </CardContent>
            </Card>

            <div className="space-y-3">
              <div className="flex gap-3">
                <Button onClick={handleSaveResume} variant="outline" className="flex-1">
                  Save Changes
                </Button>
                <Button
                  onClick={handleRunATSCheck}
                  className="flex-1"
                >
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  Run ATS Check
                </Button>
              </div>
              {data.atsScore !== null && (
                <div className="bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded-lg p-3">
                  <p className="text-sm text-green-800 dark:text-green-200 text-center">
                    ✓ ATS check completed ({data.atsScore}%). You can proceed to Step 4 for detailed results or continue to template selection.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* ATS Keywords Panel */}
          <div className="lg:col-span-1">
            <Card className="sticky top-4">
              <CardHeader>
                <CardTitle className="text-base">ATS Keywords</CardTitle>
                <p className="text-xs text-muted-foreground">
                  Extracted from Job Description
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                {data.atsKeywords ? (
                  <>
                    <div>
                      <Label className="text-xs font-semibold mb-2 block">
                        Technical Skills
                      </Label>
                      <div className="flex flex-wrap gap-1">
                        {data.atsKeywords.technical_skills.map((skill, idx) => (
                          <Badge key={idx} variant="outline" className="text-xs">
                            {skill}
                          </Badge>
                        ))}
                      </div>
                    </div>
                    <Separator />
                    <div>
                      <Label className="text-xs font-semibold mb-2 block">
                        Tools & Technologies
                      </Label>
                      <div className="flex flex-wrap gap-1">
                        {data.atsKeywords.tools_and_technologies.map((tool, idx) => (
                          <Badge key={idx} variant="outline" className="text-xs">
                            {tool}
                          </Badge>
                        ))}
                      </div>
                    </div>
                    <Separator />
                    <div>
                      <Label className="text-xs font-semibold mb-2 block">
                        Responsibilities
                      </Label>
                      <div className="flex flex-wrap gap-1">
                        {data.atsKeywords.job_responsibilities.map((resp, idx) => (
                          <Badge key={idx} variant="outline" className="text-xs">
                            {resp}
                          </Badge>
                        ))}
                      </div>
                    </div>
                    <Separator />
                    <div>
                      <Label className="text-xs font-semibold mb-2 block">
                        Industry Terms
                      </Label>
                      <div className="flex flex-wrap gap-1">
                        {data.atsKeywords.industry_terms.map((term, idx) => (
                          <Badge key={idx} variant="outline" className="text-xs">
                            {term}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    ATS keywords will appear here after tailoring your resume.
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
