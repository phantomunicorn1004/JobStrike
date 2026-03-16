"use client";

import React, { useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Badge } from "@/components/ui/badge";
import { Loader2, AlertCircle } from "lucide-react";
import { toast } from "sonner";

type StepJDInputProps = {
  data: {
    jobTitle: string;
    companyName: string;
    jdInputMethod: "paste" | "url";
    jobDescription: string;
    jdConfirmed: boolean;
  };
  updateData: (updates: Partial<any>) => void;
};

export function StepJDInput({ data, updateData }: StepJDInputProps) {
  const [localJD, setLocalJD] = useState(data.jobDescription);
  const [jdUrl, setJdUrl] = useState("");
  const [isConfirming, setIsConfirming] = useState(false);
  const [isFetching, setIsFetching] = useState(false);
  const [errors, setErrors] = useState<{
    jobTitle?: string;
    companyName?: string;
    jobDescription?: string;
    url?: string;
  }>({});

  const validate = (): boolean => {
    const newErrors: typeof errors = {};
    
    if (!data.jobTitle.trim()) {
      newErrors.jobTitle = "Job title is required";
    }
    
    if (!data.companyName.trim()) {
      newErrors.companyName = "Company name is required";
    }
    
    if (data.jdInputMethod === "paste") {
      if (!localJD.trim()) {
        newErrors.jobDescription = "Job description is required";
      } else if (localJD.trim().length < 50) {
        newErrors.jobDescription = "Job description must be at least 50 characters";
      }
    } else {
      if (!jdUrl.trim()) {
        newErrors.url = "URL is required";
      } else if (!jdUrl.match(/^https?:\/\/.+/)) {
        newErrors.url = "Please enter a valid URL";
      } else if (!localJD.trim()) {
        newErrors.jobDescription = "Please fetch the job description first";
      }
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleConfirm = async () => {
    if (!validate()) {
      toast.error("Please fix the errors before confirming");
      return;
    }

    setIsConfirming(true);
    
    // Simulate async validation
    await new Promise((resolve) => setTimeout(resolve, 500));
    
    updateData({
      jobDescription: localJD,
      jdConfirmed: true,
    });
    
    setIsConfirming(false);
    toast.success("Job description confirmed successfully");
  };

  const handleJDMethodChange = (value: string) => {
    updateData({
      jdInputMethod: value as "paste" | "url",
      jdConfirmed: false,
    });
    setErrors({});
  };

  const handleUrlFetch = async () => {
    if (!jdUrl.trim()) {
      setErrors({ ...errors, url: "URL is required" });
      return;
    }
    
    if (!jdUrl.match(/^https?:\/\/.+/)) {
      setErrors({ ...errors, url: "Please enter a valid URL" });
      return;
    }

    setIsFetching(true);
    setErrors({ ...errors, url: undefined });
    
    // Simulate URL fetching
    await new Promise((resolve) => setTimeout(resolve, 1500));
    
    // Mock fetched job description
    const mockFetchedJD = `Job Description for ${data.jobTitle || "Position"} at ${data.companyName || "Company"}

We are seeking a talented professional to join our team. The ideal candidate will have:

• Strong experience in software development
• Excellent communication skills
• Ability to work in a fast-paced environment
• Team collaboration and leadership capabilities
• Problem-solving and analytical thinking

Requirements:
- Bachelor's degree in related field
- 3+ years of relevant experience
- Proficiency in modern technologies
- Strong attention to detail

This is a great opportunity to grow your career with a dynamic company.`;
    
    setLocalJD(mockFetchedJD);
    setIsFetching(false);
    toast.success("Job description fetched successfully");
  };

  const charCount = localJD.length;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold mb-4">Input Job Description</h2>
        <p className="text-sm text-muted-foreground mb-6">
          Provide the job details to tailor your resume accordingly.
        </p>
      </div>

      <div className="space-y-4">
        <div>
          <Label htmlFor="jobTitle">Job Title *</Label>
          <Input
            id="jobTitle"
            placeholder="e.g., Senior Software Engineer"
            value={data.jobTitle}
            onChange={(e) => {
              updateData({ jobTitle: e.target.value });
              if (errors.jobTitle) setErrors({ ...errors, jobTitle: undefined });
            }}
            className={`mt-1 ${errors.jobTitle ? "border-destructive" : ""}`}
            aria-invalid={!!errors.jobTitle}
          />
          {errors.jobTitle && (
            <p className="text-sm text-destructive mt-1 flex items-center gap-1">
              <AlertCircle className="h-3 w-3" />
              {errors.jobTitle}
            </p>
          )}
        </div>

        <div>
          <Label htmlFor="companyName">Company Name *</Label>
          <Input
            id="companyName"
            placeholder="e.g., Tech Corp Inc."
            value={data.companyName}
            onChange={(e) => {
              updateData({ companyName: e.target.value });
              if (errors.companyName) setErrors({ ...errors, companyName: undefined });
            }}
            className={`mt-1 ${errors.companyName ? "border-destructive" : ""}`}
            aria-invalid={!!errors.companyName}
          />
          {errors.companyName && (
            <p className="text-sm text-destructive mt-1 flex items-center gap-1">
              <AlertCircle className="h-3 w-3" />
              {errors.companyName}
            </p>
          )}
        </div>

        <div>
          <Label>Job Description Input Method *</Label>
          <RadioGroup
            value={data.jdInputMethod}
            onValueChange={handleJDMethodChange}
            className="mt-2"
          >
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="paste" id="paste" />
              <Label htmlFor="paste" className="font-normal cursor-pointer">
                Paste Job Description
              </Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="url" id="url" />
              <Label htmlFor="url" className="font-normal cursor-pointer">
                Provide Job Posting URL
              </Label>
            </div>
          </RadioGroup>
        </div>

        {data.jdInputMethod === "paste" ? (
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label htmlFor="jobDescription">Job Description *</Label>
              <Badge variant="outline">{charCount} characters</Badge>
            </div>
            <Textarea
              id="jobDescription"
              placeholder="Paste the job description here..."
              value={localJD}
              onChange={(e) => {
                setLocalJD(e.target.value);
                if (errors.jobDescription) setErrors({ ...errors, jobDescription: undefined });
              }}
              className={`mt-1 min-h-[200px] ${errors.jobDescription ? "border-destructive" : ""}`}
              aria-invalid={!!errors.jobDescription}
            />
            {errors.jobDescription ? (
              <p className="text-sm text-destructive mt-1 flex items-center gap-1">
                <AlertCircle className="h-3 w-3" />
                {errors.jobDescription}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground mt-1">
                You can edit this before confirming.
              </p>
            )}
          </div>
        ) : (
          <div>
            <Label htmlFor="jdUrl">Job Posting URL *</Label>
            <div className="flex gap-2 mt-1">
              <Input
                id="jdUrl"
                type="url"
                placeholder="https://example.com/job-posting"
                value={jdUrl}
                onChange={(e) => {
                  setJdUrl(e.target.value);
                  if (errors.url) setErrors({ ...errors, url: undefined });
                }}
                className={`flex-1 ${errors.url ? "border-destructive" : ""}`}
                aria-invalid={!!errors.url}
              />
              <Button
                type="button"
                variant="outline"
                onClick={handleUrlFetch}
                disabled={!jdUrl.trim() || isFetching}
              >
                {isFetching ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Fetching...
                  </>
                ) : (
                  "Fetch"
                )}
              </Button>
            </div>
            {errors.url && (
              <p className="text-sm text-destructive mt-1 flex items-center gap-1">
                <AlertCircle className="h-3 w-3" />
                {errors.url}
              </p>
            )}
            {localJD && (
              <div className="mt-4">
                <Label>Fetched Job Description</Label>
                <Textarea
                  value={localJD}
                  onChange={(e) => {
                    setLocalJD(e.target.value);
                    if (errors.jobDescription) setErrors({ ...errors, jobDescription: undefined });
                  }}
                  className={`mt-1 min-h-[200px] ${errors.jobDescription ? "border-destructive" : ""}`}
                  aria-invalid={!!errors.jobDescription}
                />
                {errors.jobDescription && (
                  <p className="text-sm text-destructive mt-1 flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" />
                    {errors.jobDescription}
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        <div className="pt-4 border-t">
          <Button
            onClick={handleConfirm}
            disabled={
              isConfirming ||
              !data.jobTitle.trim() ||
              !data.companyName.trim() ||
              !localJD.trim() ||
              data.jdConfirmed
            }
            className="w-full"
          >
            {isConfirming ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Confirming...
              </>
            ) : data.jdConfirmed ? (
              "✓ Confirmed"
            ) : (
              "Confirm Job Description"
            )}
          </Button>
          {data.jdConfirmed && (
            <p className="text-sm text-green-600 mt-2 text-center">
              Job description confirmed. You can proceed to the next step.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
