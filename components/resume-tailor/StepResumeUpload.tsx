"use client";

import React, { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Upload, FileText, X, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type StepResumeUploadProps = {
  data: {
    resumeFile: File | null;
    resumeFileName: string;
    resumeFileSize: string;
    resumeText?: string;
  };
  updateData: (updates: Partial<any>) => void;
};

export function StepResumeUpload({ data, updateData }: StepResumeUploadProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const acceptedTypes = [".pdf", ".docx"];
  const maxSizeMB = 5;

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + " KB";
    return (bytes / (1024 * 1024)).toFixed(2) + " MB";
  };

  const validateFile = (file: File): boolean => {
    setError(null);
    const extension = "." + file.name.split(".").pop()?.toLowerCase();
    if (!acceptedTypes.includes(extension)) {
      const errorMsg = `Invalid file type. Please upload a ${acceptedTypes.join(" or ")} file.`;
      setError(errorMsg);
      toast.error(errorMsg);
      return false;
    }
    if (file.size > maxSizeMB * 1024 * 1024) {
      const errorMsg = `File size exceeds ${maxSizeMB}MB limit.`;
      setError(errorMsg);
      toast.error(errorMsg);
      return false;
    }
    return true;
  };

  const handleFileSelect = async (file: File) => {
    if (!validateFile(file)) {
      return;
    }

    setIsParsing(true);
    setError(null);
    
    // Simulate file parsing delay
    await new Promise((resolve) => setTimeout(resolve, 700));
    
    // Mock resume text extraction
    const mockResumeText = `JOHN DOE
Software Engineer
Email: john.doe@email.com | Phone: (555) 123-4567

PROFESSIONAL SUMMARY
Experienced software engineer with 5+ years of expertise in full-stack development, specializing in React, Node.js, and cloud technologies. Proven track record of delivering scalable solutions and leading cross-functional teams.

TECHNICAL SKILLS
• Programming Languages: JavaScript, TypeScript, Python, Java
• Frameworks: React, Node.js, Express, Next.js
• Databases: PostgreSQL, MongoDB, Redis
• Cloud: AWS, Docker, Kubernetes
• Tools: Git, CI/CD, Agile/Scrum

EXPERIENCE
Senior Software Engineer | Tech Corp | 2020 - Present
• Led development of microservices architecture serving 1M+ users
• Implemented CI/CD pipelines reducing deployment time by 60%
• Mentored junior developers and conducted code reviews

Software Engineer | StartupXYZ | 2018 - 2020
• Built responsive web applications using React and Node.js
• Collaborated with design team to implement pixel-perfect UIs
• Optimized database queries improving performance by 40%

EDUCATION
Bachelor of Science in Computer Science
University of Technology | 2014 - 2018`;

    updateData({
      resumeFile: file,
      resumeFileName: file.name,
      resumeFileSize: formatFileSize(file.size),
      resumeText: mockResumeText,
    });
    
    setIsParsing(false);
    toast.success("Resume uploaded and parsed successfully");
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);

    const file = e.dataTransfer.files[0];
    if (file) {
      handleFileSelect(file);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileSelect(file);
    }
  };

  const handleRemove = () => {
    updateData({
      resumeFile: null,
      resumeFileName: "",
      resumeFileSize: "",
    });
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold mb-4">Select Resume</h2>
        <p className="text-sm text-muted-foreground mb-6">
          Upload your resume file. Only one file is allowed.
        </p>
      </div>

      {error && (
        <div className="bg-destructive/10 border border-destructive rounded-lg p-4 flex items-start gap-2">
          <AlertCircle className="h-5 w-5 text-destructive mt-0.5" />
          <p className="text-sm text-destructive flex-1">{error}</p>
        </div>
      )}

      {!data.resumeFile ? (
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          className={cn(
            "border-2 border-dashed rounded-lg p-12 text-center transition-colors",
            isDragging
              ? "border-primary bg-primary/5"
              : "border-muted hover:border-primary/50",
            isParsing && "opacity-50 pointer-events-none"
          )}
        >
          {isParsing ? (
            <>
              <Loader2 className="h-12 w-12 mx-auto mb-4 text-primary animate-spin" />
              <p className="text-lg font-medium mb-2">Parsing resume...</p>
              <p className="text-sm text-muted-foreground">
                Extracting content from your file
              </p>
            </>
          ) : (
            <>
              <Upload className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
              <p className="text-lg font-medium mb-2">
                Drag and drop your resume here
              </p>
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
                onChange={handleFileInputChange}
                className="hidden"
              />
              <p className="text-xs text-muted-foreground mt-4">
                Accepted formats: PDF, DOCX (Max {maxSizeMB}MB)
              </p>
            </>
          )}
        </div>
      ) : (
        <Card className="border-green-500">
          <CardContent className="pt-6">
            <div className="flex items-start gap-4">
              <div className="p-3 bg-green-100 dark:bg-green-900/20 rounded-lg">
                <CheckCircle2 className="h-6 w-6 text-green-600 dark:text-green-400" />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-medium">{data.resumeFileName}</h3>
                  <Badge variant="outline" className="text-xs">Ready</Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  {data.resumeFileSize}
                </p>
                {data.resumeText && (
                  <p className="text-xs text-muted-foreground mt-2">
                    Content extracted successfully
                  </p>
                )}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={handleRemove}
                disabled={isParsing}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="mt-4 pt-4 border-t">
              <Button
                type="button"
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                className="w-full"
                disabled={isParsing}
              >
                Replace File
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.docx"
                onChange={handleFileInputChange}
                className="hidden"
              />
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
