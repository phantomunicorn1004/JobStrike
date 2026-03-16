"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, FileText } from "lucide-react";
import { toast } from "sonner";
import { Progress } from "@/components/ui/progress";

type StepGenerateProps = {
  data: {
    jobTitle: string;
    companyName: string;
    resumeFileName: string;
    tailoredResume: string;
    selectedTemplate: string | null;
    fileFormat: "pdf" | "docx";
    resumeGenerated: boolean;
    generatedFile?: {
      fileName: string;
      fileType: string;
      fileSize: number;
      downloadUrl: string;
    };
  };
  updateData: (updates: Partial<any>) => void;
};

export function StepGenerate({ data, updateData }: StepGenerateProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState(0);

  const handleGenerate = async () => {
    if (!data.tailoredResume || !data.selectedTemplate) {
      toast.error("Missing required information. Please complete previous steps.");
      return;
    }

    setIsGenerating(true);
    setProgress(0);
    toast.info("Generating your resume file...");

    try {
      // Simulate progress
      const progressInterval = setInterval(() => {
        setProgress((prev) => {
          if (prev >= 90) {
            clearInterval(progressInterval);
            return 90;
          }
          return prev + 10;
        });
      }, 150);

      const response = await fetch("/api/generate-resume", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          tailoredResumeText: data.tailoredResume,
          templateId: data.selectedTemplate,
          fileFormat: data.fileFormat,
        }),
      });

      clearInterval(progressInterval);
      setProgress(100);

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to generate resume file");
      }

      const result = await response.json();

      updateData({
        resumeGenerated: true,
        generatedFile: {
          fileName: result.fileName,
          fileType: result.fileType,
          fileSize: result.fileSize,
          downloadUrl: result.downloadUrl,
        },
      });

      setIsGenerating(false);
      toast.success("Resume file generated successfully!");
    } catch (error) {
      console.error("Error generating resume:", error);
      setIsGenerating(false);
      setProgress(0);
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to generate resume file. Please try again."
      );
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold mb-4">Generate Resume File</h2>
        <p className="text-sm text-muted-foreground mb-6">
          Review your selections and generate the final resume file.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Summary</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-muted-foreground mb-1">Job Title</p>
              <p className="font-medium">{data.jobTitle || "N/A"}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground mb-1">Company</p>
              <p className="font-medium">{data.companyName || "N/A"}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground mb-1">Resume</p>
              <p className="font-medium">{data.resumeFileName || "N/A"}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground mb-1">Template</p>
              <p className="font-medium">
                {data.selectedTemplate
                  ? data.selectedTemplate.charAt(0).toUpperCase() +
                    data.selectedTemplate.slice(1)
                  : "N/A"}
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground mb-1">Format</p>
              <Badge variant="outline">{data.fileFormat.toUpperCase()}</Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      {!data.resumeGenerated ? (
        <div className="space-y-4">
          <Button
            onClick={handleGenerate}
            disabled={isGenerating}
            className="w-full"
            size="lg"
          >
            {isGenerating ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Generating Resume...
              </>
            ) : (
              <>
                <FileText className="h-4 w-4 mr-2" />
                Generate Resume
              </>
            )}
          </Button>

          {isGenerating && (
            <div className="bg-muted/50 p-4 rounded-lg space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Generating resume...</span>
                <span className="font-medium">{progress}%</span>
              </div>
              <Progress value={progress} className="h-2" />
            </div>
          )}
        </div>
      ) : (
        <Card className="border-green-500">
          <CardContent className="pt-6 space-y-4">
            <div className="flex items-center justify-center gap-2 text-green-600">
              <FileText className="h-5 w-5" />
              <p className="font-medium">Resume generated successfully!</p>
            </div>
            {data.generatedFile && (
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">File:</span>
                  <span className="font-medium">{data.generatedFile.fileName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Size:</span>
                  <span className="font-medium">
                    {(data.generatedFile.fileSize / 1024).toFixed(2)} KB
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Format:</span>
                  <Badge variant="outline">
                    {data.generatedFile.fileType.toUpperCase()}
                  </Badge>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
