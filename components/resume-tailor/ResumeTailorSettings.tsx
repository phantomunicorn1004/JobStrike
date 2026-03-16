"use client";

import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { X, Upload, Trash2, FileText } from "lucide-react";
import { toast } from "sonner";

type ResumeTailorSettingsProps = {
  onClose: () => void;
  onSave: () => void;
};

export function ResumeTailorSettings({ onClose, onSave }: ResumeTailorSettingsProps) {
  const [prompt, setPrompt] = useState("");
  const [googleDriveEnabled, setGoogleDriveEnabled] = useState(false);
  const [templates, setTemplates] = useState<Array<{ id: string; name: string; file: File | null }>>([]);

  useEffect(() => {
    const savedPrompt = localStorage.getItem("resumeTailorPrompt");
    if (savedPrompt) {
      setPrompt(savedPrompt);
    } else {
      setPrompt(`You are an expert resume writer specializing in ATS optimization. Your task is to tailor a resume for a specific job.

Job Title: {jobTitle}
Company: {companyName}
Job Description:
{jobDescription}

Original Resume:
{resumeText}

Instructions:
1. Analyze the job description to identify key skills, technologies, and requirements
2. Tailor the resume to highlight relevant experience and achievements
3. Use keywords from the job description naturally throughout the resume
4. Maintain the original structure and format
5. Ensure all content is truthful and accurate
6. Focus on quantifiable achievements and impact

Return a JSON object with:
- profile_title: Optimized job title/heading
- professional_summary: Tailored summary (2-3 sentences)
- tailored_experience: Array of experience entries with jobTitle, company, and bullets array
- ats_keywords: Object with technical_skills, tools_and_technologies, job_responsibilities, industry_terms arrays`);
    }

    const savedGoogleDrive = localStorage.getItem("googleDriveEnabled");
    setGoogleDriveEnabled(savedGoogleDrive === "true");
  }, []);

  const handleSavePrompt = () => {
    localStorage.setItem("resumeTailorPrompt", prompt);
    toast.success("Prompt saved");
  };

  const handleToggleGoogleDrive = async (enabled: boolean) => {
    setGoogleDriveEnabled(enabled);
    localStorage.setItem("googleDriveEnabled", enabled.toString());

    if (enabled) {
      try {
        const response = await fetch("/api/google-drive/check-auth");
        const data = await response.json();

        if (!data.authenticated) {
          const authResponse = await fetch("/api/google-drive/auth");
          const authData = await authResponse.json();
          window.location.href = authData.url;
          return;
        }

        toast.success("Google Drive connected");
      } catch (error) {
        console.error("Error checking Google Drive auth:", error);
        toast.error("Failed to connect Google Drive");
      }
    }
  };

  const handleTemplateUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith(".docx")) {
      toast.error("Only DOCX templates are supported");
      return;
    }

    const templateId = `template-${Date.now()}`;
    setTemplates((prev) => [
      ...prev,
      { id: templateId, name: file.name, file },
    ]);
    toast.success("Template uploaded");
  };

  const handleRemoveTemplate = (id: string) => {
    setTemplates((prev) => prev.filter((t) => t.id !== id));
    toast.success("Template removed");
  };

  return (
    <div className="w-full max-w-4xl mx-auto py-8 px-4">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold">Resume Tailor Settings</h1>
        <Button variant="ghost" size="icon" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>AI Prompt Configuration</CardTitle>
            <p className="text-sm text-muted-foreground mt-2">
              Customize the prompt used for resume tailoring. Use placeholders: {"{jobTitle}"}, {"{companyName}"}, {"{jobDescription}"}, {"{resumeText}"}
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="prompt">Tailoring Prompt</Label>
              <Textarea
                id="prompt"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                className="mt-2 min-h-[300px] font-mono text-sm"
                placeholder="Enter your custom prompt..."
              />
            </div>
            <Button onClick={handleSavePrompt}>Save Prompt</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Resume Templates</CardTitle>
            <p className="text-sm text-muted-foreground mt-2">
              Upload DOCX templates with placeholder variables using {"<<"}variable{">>"} syntax
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="template-upload">Upload Template</Label>
              <div className="mt-2">
                <input
                  id="template-upload"
                  type="file"
                  accept=".docx"
                  onChange={handleTemplateUpload}
                  className="hidden"
                />
                <Button
                  variant="outline"
                  onClick={() => document.getElementById("template-upload")?.click()}
                >
                  <Upload className="h-4 w-4 mr-2" />
                  Upload Template
                </Button>
              </div>
            </div>

            {templates.length > 0 && (
              <div className="space-y-2">
                <Label>Uploaded Templates</Label>
                {templates.map((template) => (
                  <div
                    key={template.id}
                    className="flex items-center justify-between p-3 border rounded-lg"
                  >
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm">{template.name}</span>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleRemoveTemplate(template.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Google Drive Integration</CardTitle>
            <p className="text-sm text-muted-foreground mt-2">
              Enable automatic upload of tailored resumes to Google Drive
            </p>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="google-drive-toggle">Enable Google Drive Upload</Label>
                <p className="text-sm text-muted-foreground mt-1">
                  When enabled, tailored resumes will be automatically uploaded to Google Drive
                </p>
              </div>
              <Switch
                id="google-drive-toggle"
                checked={googleDriveEnabled}
                onCheckedChange={handleToggleGoogleDrive}
              />
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => { onSave(); onClose(); }}>
            Save Settings
          </Button>
        </div>
      </div>
    </div>
  );
}
