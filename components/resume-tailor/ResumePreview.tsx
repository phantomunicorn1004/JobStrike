"use client";

import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Edit, Download, Sparkles } from "lucide-react";
import type { ResumeContent } from "@/lib/resumeTemplates/types";

type ResumePreviewProps = {
  resumeContent: ResumeContent;
  onAccept: () => void;
  onEdit: () => void;
  isGenerating?: boolean;
};

export function ResumePreview({
  resumeContent,
  onAccept,
  onEdit,
  isGenerating = false,
}: ResumePreviewProps) {
  return (
    <div className="w-full max-w-4xl mx-auto py-8 px-4 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Final Resume Preview</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Review your tailored resume before downloading
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onEdit} disabled={isGenerating}>
            <Edit className="h-4 w-4 mr-2" />
            Edit Again
          </Button>
          <Button onClick={onAccept} disabled={isGenerating}>
            {isGenerating ? (
              <>
                <Sparkles className="h-4 w-4 mr-2 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <CheckCircle2 className="h-4 w-4 mr-2" />
                Accept & Download
              </>
            )}
          </Button>
        </div>
      </div>

      <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
        <p className="text-sm text-blue-900 dark:text-blue-200">
          <strong>Note:</strong> Only the profile title, summary, skills, and experience
          accomplishments have been optimized. All other sections (company names, dates,
          education, certifications) remain unchanged from your original resume.
        </p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="space-y-6">
            {/* Header */}
            <div className="text-center space-y-2 pb-4 border-b">
              <h2 className="text-3xl font-bold">{resumeContent.profileTitle}</h2>
              {resumeContent.contactInfo && (
                <p className="text-sm text-muted-foreground whitespace-pre-line">
                  {resumeContent.contactInfo}
                </p>
              )}
            </div>

            {/* Professional Summary */}
            {resumeContent.professionalSummary && (
              <div className="space-y-2">
                <h3 className="text-lg font-semibold uppercase tracking-wide">
                  Professional Summary
                </h3>
                <Badge variant="outline" className="text-xs">
                  Optimized
                </Badge>
                <p className="text-sm leading-relaxed whitespace-pre-line">
                  {resumeContent.professionalSummary}
                </p>
              </div>
            )}

            <Separator />

            {/* Experience - CRITICAL: Always render if data exists */}
            {resumeContent.experience && Array.isArray(resumeContent.experience) && resumeContent.experience.length > 0 ? (
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-semibold uppercase tracking-wide">
                    Professional Experience
                  </h3>
                  <Badge variant="outline" className="text-xs">
                    Accomplishments Optimized
                  </Badge>
                </div>
                {resumeContent.experience.map((exp, idx) => (
                  <div key={idx} className="space-y-2">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-semibold text-base">{exp.jobTitle || "Untitled Position"}</p>
                        {exp.company && (
                          <p className="text-sm text-muted-foreground italic">{exp.company}</p>
                        )}
                      </div>
                    </div>
                    {exp.bullets && Array.isArray(exp.bullets) && exp.bullets.length > 0 && (
                      <ul className="list-disc list-inside space-y-1 ml-4">
                        {exp.bullets.map((bullet, bulletIdx) => (
                          <li key={bulletIdx} className="text-sm leading-relaxed">
                            {bullet}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-4 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg border border-yellow-200 dark:border-yellow-800">
                <p className="text-sm text-yellow-900 dark:text-yellow-200 font-medium">
                  ⚠️ Work Experience section not found. This may indicate a parsing issue. Please check your original resume format.
                </p>
              </div>
            )}

            <Separator />

            {/* Technical Skills */}
            {resumeContent.skills && resumeContent.skills.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-semibold uppercase tracking-wide">
                    Technical Skills
                  </h3>
                  <Badge variant="outline" className="text-xs">
                    Optimized
                  </Badge>
                </div>
                <div className="flex flex-wrap gap-2">
                  {resumeContent.skills.map((skill, idx) => (
                    <Badge key={idx} variant="secondary" className="text-sm">
                      {skill}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            <Separator />

            {/* Education */}
            {resumeContent.education && resumeContent.education.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-lg font-semibold uppercase tracking-wide">Education</h3>
                {resumeContent.education.map((edu, idx) => (
                  <p key={idx} className="text-sm">{edu}</p>
                ))}
              </div>
            )}

            {/* Certifications */}
            {resumeContent.certifications &&
              resumeContent.certifications.length > 0 && (
                <>
                  <Separator />
                  <div className="space-y-2">
                    <h3 className="text-lg font-semibold uppercase tracking-wide">
                      Certifications
                    </h3>
                    {resumeContent.certifications.map((cert, idx) => (
                      <p key={idx} className="text-sm">{cert}</p>
                    ))}
                  </div>
                </>
              )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
