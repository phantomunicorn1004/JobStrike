"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Upload,
  FileText,
  X,
  Loader2,
  Sparkles,
  Download,
  RefreshCw,
  Settings,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ATSScoreComparison } from "./ATSScoreComparison";
import { TailorResults } from "./TailorResults";
import { ResumeTailorSettings } from "./ResumeTailorSettings";
import { ResumePreview } from "./ResumePreview";
import type { ResumeContent } from "@/lib/resumeTemplates/types";
import type { ResumeStructure } from "@/lib/resume/structure/types";

type TailorState =
  | "input" // User entering information
  | "tailoring" // AI processing
  | "preview" // Preview tailored resume
  | "results" // Showing results with downloads
  | "settings"; // Advanced settings

type TailorData = {
  jobTitle: string;
  companyName: string;
  jobDescription: string;
  resumeFile: File | null;
  resumeFileName: string;
  resumeText: string;
  tailoredResume: string;
  tailoredContent?: ResumeContent; // Structured resume data (single source of truth)
  structure?: ResumeStructure; // Original structure for rebuilding
  formatMetadata?: {
    originalDocxBuffer?: string; // Base64 encoded original DOCX buffer
    docxParagraphsWithFormat?: any[]; // Paragraph formatting metadata
  };
  originalATSScore: number | null;
  improvedATSScore: number | null;
  matchedKeywords: string[];
  missingKeywords: string[];
  recommendations: string[];
  generatedFiles?: {
    docx: {
      fileName: string;
      fileType: string;
      fileSize: number;
      downloadUrl: string;
      mimeType: string;
    };
    pdf: {
      fileName: string;
      fileType: string;
      fileSize: number;
      downloadUrl: string;
      mimeType: string;
    };
  };
  uploadedToDrive: boolean;
  googleDriveMetadata?: {
    fileId: string;
    fileUrl: string;
  };
};

type ProgressStage = "analyzing" | "tailoring" | "ats-checking" | "generating";

export function ResumeTailor() {
  const [state, setState] = useState<TailorState>("input");
  const [showSettings, setShowSettings] = useState(false);
  const [progressStage, setProgressStage] = useState<ProgressStage>("analyzing");
  const [progress, setProgress] = useState(0);

  const [data, setData] = useState<TailorData>({
    jobTitle: "",
    companyName: "",
    jobDescription: "",
    resumeFile: null,
    resumeFileName: "",
    resumeText: "",
    tailoredResume: "",
    originalATSScore: null,
    improvedATSScore: null,
    matchedKeywords: [],
    missingKeywords: [],
    recommendations: [],
    uploadedToDrive: false,
  });

  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isParsing, setIsParsing] = useState(false);

  const updateData = (updates: Partial<TailorData>) => {
    setData((prev) => ({ ...prev, ...updates }));
  };

  const handleFileSelect = async (file: File) => {
    // Client-side validation
    const extension = file.name.split(".").pop()?.toLowerCase();
    if (!extension || !["pdf", "docx"].includes(extension)) {
      toast.error("Please upload a PDF or DOCX file");
      return;
    }

    const maxSize = 5 * 1024 * 1024; // 5MB
    if (file.size > maxSize) {
      const maxSizeMB = (maxSize / (1024 * 1024)).toFixed(0);
      toast.error(`File size must be less than ${maxSizeMB}MB`);
      return;
    }

    if (file.size === 0) {
      toast.error("File is empty. Please select a valid file.");
      return;
    }

    setIsParsing(true);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/resume-parse", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage =
          errorData.error || `Failed to parse ${extension.toUpperCase()} file`;
        throw new Error(errorMessage);
      }

      const result = await response.json();
      const resumeText = result.text || "";

      if (!resumeText.trim()) {
        throw new Error(
          "Could not extract text from resume. The file may be empty, corrupted, or contain only images."
        );
      }

      updateData({
        resumeFile: file,
        resumeFileName: file.name,
        resumeText,
      });

      toast.success(`Resume parsed successfully (${result.fileType?.toUpperCase() || extension.toUpperCase()})`);
    } catch (error) {
      console.error("Error parsing resume:", error);
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Failed to parse resume. Please try again.";
      toast.error(errorMessage, { duration: 5000 });
    } finally {
      setIsParsing(false);
    }
  };

  const handleTailor = async () => {
    if (!data.jobTitle.trim() || !data.companyName.trim() || !data.jobDescription.trim()) {
      toast.error("Please fill in all required fields");
      return;
    }

    if (!data.resumeFile || !data.resumeText) {
      toast.error("Please upload your resume");
      return;
    }

    setState("tailoring");
    setProgress(0);
    setProgressStage("analyzing");

    try {
      // Step 1: Check original ATS score
      setProgressStage("analyzing");
      setProgress(20);
      toast.info("Analyzing original resume...");

      const originalATSResponse = await fetch("/api/ats-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobTitle: data.jobTitle,
          jobDescription: data.jobDescription,
          tailoredResumeText: data.resumeText,
        }),
      });

      if (!originalATSResponse.ok) {
        throw new Error("Failed to analyze original resume");
      }

      const originalATSData = await originalATSResponse.json();
      updateData({ originalATSScore: originalATSData.ats_score || 0 });

      // Step 2: Tailor resume with structure preservation
      setProgressStage("tailoring");
      setProgress(40);
      toast.info("Tailoring resume while preserving your original format...");

      const formData = new FormData();
      formData.append("file", data.resumeFile);
      formData.append("jobTitle", data.jobTitle);
      formData.append("jobDescription", data.jobDescription);

      const tailorResponse = await fetch("/api/resume-tailor-with-structure", {
        method: "POST",
        body: formData,
      });

      if (!tailorResponse.ok) {
        const errorData = await tailorResponse.json();
        throw new Error(errorData.error || "Failed to tailor resume");
      }

      const tailorResult = await tailorResponse.json();
      
      // Validate response structure - now expects structured data, not files
      if (!tailorResult.tailoredContent || !tailorResult.structure) {
        throw new Error("Invalid response: missing resume data");
      }

      // Store structured resume data (single source of truth)
      // Include format metadata for DOCX format preservation
      updateData({
        tailoredResume: tailorResult.tailoredText,
        tailoredContent: tailorResult.tailoredContent,
        structure: tailorResult.structure,
        formatMetadata: tailorResult.formatMetadata,
      });

      // Step 3: Check improved ATS score
      setProgressStage("ats-checking");
      setProgress(70);
      toast.info("Checking improved ATS score...");

      const improvedATSResponse = await fetch("/api/ats-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobTitle: data.jobTitle,
          jobDescription: data.jobDescription,
          tailoredResumeText: tailorResult.tailoredText,
        }),
      });

      if (!improvedATSResponse.ok) {
        throw new Error("Failed to check improved ATS score");
      }

      const improvedATSData = await improvedATSResponse.json();
      updateData({
        improvedATSScore: improvedATSData.ats_score || 0,
        matchedKeywords: improvedATSData.matched_keywords || [],
        missingKeywords: improvedATSData.missing_keywords || [],
        recommendations: improvedATSData.recommendations || [],
      });

      setProgress(100);
      setState("preview");
      toast.success("Resume tailored successfully! Please review the preview.");
    } catch (error) {
      console.error("Error tailoring resume:", error);
      toast.error(
        error instanceof Error ? error.message : "Failed to tailor resume. Please try again."
      );
      setState("input");
    }
  };


  const handleRetailor = () => {
    setState("input");
    updateData({
      tailoredResume: "",
      tailoredContent: undefined,
      structure: undefined,
      originalATSScore: null,
      improvedATSScore: null,
      matchedKeywords: [],
      missingKeywords: [],
      recommendations: [],
      generatedFiles: undefined,
    });
  };

  const handleAcceptPreview = async () => {
    // Validate required data before generating files
    if (!data.tailoredContent) {
      toast.error("Missing resume content. Please tailor your resume again.");
      return;
    }
    if (!data.structure) {
      toast.error("Missing resume structure. Please tailor your resume again.");
      return;
    }
    if (!data.tailoredContent.profileTitle || !data.tailoredContent.profileTitle.trim()) {
      toast.error("Invalid resume content: profile title is required.");
      return;
    }
    if (!data.structure.sections || !Array.isArray(data.structure.sections)) {
      toast.error("Invalid resume structure: sections are required.");
      return;
    }

    setProgressStage("generating");
    setProgress(0);
    toast.info("Generating resume files...");

    try {
      const response = await fetch("/api/resume-generate-files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tailoredContent: data.tailoredContent,
          structure: data.structure,
          formatMetadata: data.formatMetadata, // Include format metadata for DOCX preservation
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to generate files");
      }

      const result = await response.json();
      
      if (!result.files || !result.files.docx || !result.files.pdf) {
        throw new Error("Invalid response: missing file data");
      }

      updateData({
        generatedFiles: {
          docx: result.files.docx,
          pdf: result.files.pdf,
        },
      });

      setProgress(100);
      setState("results");
      toast.success("Resume files generated successfully!");
    } catch (error) {
      console.error("Error generating files:", error);
      toast.error(
        error instanceof Error ? error.message : "Failed to generate files. Please try again."
      );
    }
  };

  const handleDownload = async (format: "docx" | "pdf") => {
    // Validate files are generated
    if (!data.generatedFiles) {
      toast.error("Files not generated. Please accept the preview first.");
      return;
    }

    const file = data.generatedFiles[format];
    if (!file || !file.downloadUrl) {
      toast.error(`No ${format.toUpperCase()} file available for download`);
      return;
    }

    try {
      // Extract base64 data from data URL
      let base64Data: string;
      if (file.downloadUrl.startsWith("data:")) {
        const matches = file.downloadUrl.match(/^data:[^;]+;base64,(.+)$/);
        if (!matches || !matches[1]) {
          throw new Error("Invalid data URL format");
        }
        base64Data = matches[1];
      } else {
        // For non-data URLs, fetch and convert
        const response = await fetch(file.downloadUrl);
        if (!response.ok) {
          throw new Error(`Failed to fetch file: ${response.statusText}`);
        }
        const blob = await response.blob();
        const arrayBuffer = await blob.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);
        let binary = "";
        for (let i = 0; i < bytes.length; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        base64Data = btoa(binary);
      }

      // Convert base64 to blob
      const byteCharacters = atob(base64Data);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: file.mimeType });

      // Create download link
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.fileName;
      document.body.appendChild(a);
      a.click();
      
      // Cleanup
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      
      toast.success(`${format.toUpperCase()} downloaded successfully`);
    } catch (error) {
      console.error(`Error downloading ${format}:`, error);
      toast.error(`Failed to download ${format.toUpperCase()}. ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  };

  const handleGenerateFile = async () => {
    if (!data.tailoredResume) {
      toast.error("No tailored resume available");
      return;
    }

    try {
      const response = await fetch("/api/generate-resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tailoredResumeText: data.tailoredResume,
          templateId: "modern",
          fileFormat: "pdf",
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to generate resume");
      }

      const result = await response.json();
      updateData({ generatedFiles: result });
      toast.success("Resume file generated successfully");
    } catch (error) {
      console.error("Error generating file:", error);
      toast.error("Failed to generate resume file");
    }
  };

  if (showSettings) {
    return (
      <ResumeTailorSettings
        onClose={() => setShowSettings(false)}
        onSave={() => {
          setShowSettings(false);
          toast.success("Settings saved");
        }}
      />
    );
  }

  if (state === "tailoring") {
    return (
      <div className="w-full max-w-4xl mx-auto py-8 px-4">
        <Card>
          <CardContent className="pt-12 pb-12">
            <div className="text-center space-y-6">
              <div className="flex justify-center">
                <div className="relative">
                  <Loader2 className="h-16 w-16 text-primary animate-spin" />
                  <Sparkles className="h-8 w-8 text-primary absolute -top-2 -right-2 animate-pulse" />
                </div>
              </div>
              <div>
                <h2 className="text-2xl font-semibold mb-2">Tailoring Your Resume</h2>
                <p className="text-muted-foreground">
                  {progressStage === "analyzing" && "Analyzing your original resume..."}
                  {progressStage === "tailoring" && "Optimizing content with AI..."}
                  {progressStage === "ats-checking" && "Checking ATS compatibility..."}
                  {progressStage === "generating" && "Finalizing improvements..."}
                </p>
              </div>
              <div className="max-w-md mx-auto">
                <Progress value={progress} className="h-2" />
                <p className="text-sm text-muted-foreground mt-2">{progress}% complete</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (state === "preview") {
    if (!data.tailoredContent) {
      toast.error("Missing resume data. Please tailor your resume again.");
      setState("input");
      return null;
    }

    return (
      <ResumePreview
        resumeContent={data.tailoredContent}
        onAccept={handleAcceptPreview}
        onEdit={handleRetailor}
        isGenerating={progressStage === "generating"}
      />
    );
  }

  if (state === "results") {
    return (
      <div className="w-full max-w-4xl mx-auto py-8 px-4 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold">Resume Ready</h1>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setShowSettings(true)}>
              <Settings className="h-4 w-4 mr-2" />
              Settings
            </Button>
            <Button variant="outline" onClick={handleRetailor}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Re-tailor
            </Button>
          </div>
        </div>

        <ATSScoreComparison
          originalScore={data.originalATSScore}
          improvedScore={data.improvedATSScore}
        />

        <TailorResults
          data={data}
          onDownload={handleDownload}
          onGenerateFile={() => {}}
          updateData={updateData}
        />
      </div>
    );
  }

  return (
    <div className="w-full max-w-4xl mx-auto py-8 px-4">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold">Resume Tailor</h1>
        <Button variant="outline" onClick={() => setShowSettings(true)}>
          <Settings className="h-4 w-4 mr-2" />
          Settings
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Tailor Your Resume</CardTitle>
          <p className="text-sm text-muted-foreground mt-2">
            Enter job details and upload your resume. We'll optimize it for ATS and the role.
          </p>
          <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
            <p className="text-sm font-medium text-blue-900 dark:text-blue-200 mb-2">
              What We'll Improve:
            </p>
            <ul className="text-xs text-blue-800 dark:text-blue-300 space-y-1 list-disc list-inside">
              <li>Profile/headline title</li>
              <li>Professional summary</li>
              <li>Technical skills (reorder & normalize)</li>
              <li>Work experience accomplishments (bullet points only)</li>
            </ul>
            <p className="text-xs text-blue-700 dark:text-blue-400 mt-2 font-medium">
              Everything else (company names, dates, education, certifications) remains unchanged.
            </p>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="jobTitle">Job Title *</Label>
              <Input
                id="jobTitle"
                placeholder="e.g., Senior Software Engineer"
                value={data.jobTitle}
                onChange={(e) => updateData({ jobTitle: e.target.value })}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="companyName">Company Name *</Label>
              <Input
                id="companyName"
                placeholder="e.g., Tech Corp Inc."
                value={data.companyName}
                onChange={(e) => updateData({ companyName: e.target.value })}
                className="mt-1"
              />
            </div>
          </div>

          <div>
            <Label htmlFor="jobDescription">Job Description *</Label>
            <Textarea
              id="jobDescription"
              placeholder="Paste the job description here..."
              value={data.jobDescription}
              onChange={(e) => updateData({ jobDescription: e.target.value })}
              className="mt-1 min-h-[200px]"
            />
            <p className="text-xs text-muted-foreground mt-1">
              {data.jobDescription.length} characters
            </p>
          </div>

          <Separator />

          <div>
            <Label>Resume File *</Label>
            {!data.resumeFile ? (
              <div
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDragging(false);
                  const file = e.dataTransfer.files[0];
                  if (file) handleFileSelect(file);
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                className={cn(
                  "border-2 border-dashed rounded-lg p-12 text-center transition-colors mt-2",
                  isDragging ? "border-primary bg-primary/5" : "border-muted hover:border-primary/50",
                  isParsing && "opacity-50 pointer-events-none"
                )}
              >
                {isParsing ? (
                  <>
                    <Loader2 className="h-12 w-12 mx-auto mb-4 text-primary animate-spin" />
                    <p className="text-lg font-medium">Parsing resume...</p>
                  </>
                ) : (
                  <>
                    <Upload className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                    <p className="text-lg font-medium mb-2">Drag and drop your resume here</p>
                    <p className="text-sm text-muted-foreground mb-4">or</p>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      Browse Files
                    </Button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".pdf,.docx"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleFileSelect(file);
                      }}
                      className="hidden"
                    />
                    <p className="text-xs text-muted-foreground mt-4">
                      Accepted: PDF, DOCX (Max 5MB)
                    </p>
                  </>
                )}
              </div>
            ) : (
              <Card className="mt-2 border-green-500">
                <CardContent className="pt-6">
                  <div className="flex items-start gap-4">
                    <div className="p-3 bg-green-100 dark:bg-green-900/20 rounded-lg">
                      <FileText className="h-6 w-6 text-green-600 dark:text-green-400" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-medium">{data.resumeFileName}</h3>
                        <Badge variant="outline">Ready</Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {data.resumeText ? "Content extracted" : "Ready to process"}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        updateData({
                          resumeFile: null,
                          resumeFileName: "",
                          resumeText: "",
                        });
                        if (fileInputRef.current) fileInputRef.current.value = "";
                      }}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          <Separator />

          <Button
            onClick={handleTailor}
            disabled={
              !data.jobTitle.trim() ||
              !data.companyName.trim() ||
              !data.jobDescription.trim() ||
              !data.resumeFile ||
              !data.resumeText
            }
            className="w-full"
            size="lg"
          >
            <Sparkles className="h-4 w-4 mr-2" />
            Tailor Resume
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
