"use client";

import React, { useEffect, useState } from "react";
import JobsLayout from "@/app/jobs-layout";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Upload, FileText, Loader2, CheckCircle2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import type {
  ResumeContent,
  SkillEntry,
} from "@/lib/resumeTemplates/types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  GripVertical,
  Trash2,
  ChevronDown,
  ChevronUp,
  Sparkles,
  Pencil,
  User,
  Mail,
  Briefcase,
} from "lucide-react";

type UploadStatus = "idle" | "uploading" | "success" | "error";

/** Ensure content has skillEntries (from skillEntries or from skills object/array). */
function normalizeSkillEntries(c: ResumeContent): ResumeContent {
  if (c.skillEntries && c.skillEntries.length > 0) {
    return c;
  }
  const skills = c.skills;
  const entries: SkillEntry[] = !skills
    ? []
    : Array.isArray(skills)
      ? skills.map((s) => ({ label: s, subSkills: [] as string[] }))
      : Object.entries(skills).map(([label, subSkills]) => ({
          label,
          subSkills: subSkills ?? [],
        }));
  return { ...c, skillEntries: entries };
}

type AddResumeMethod = "choose" | "parse" | "manual";

const EMPTY_RESUME_CONTENT: ResumeContent = {
  profileTitle: "",
  professionalSummary: "",
  experience: [],
  contactInfo: "",
  skills: {},
  skillEntries: [],
};

const EMPTY_RESUME_STRUCTURE = {
  sections: [],
  originalFormat: { fileType: "pdf" as const },
};

type ResumeRow = {
  id: number;
  roleTitle: string;
};

/** Editable form view of resume content (same layout as Add Resume editor). */
function ResumeFormView({
  content,
  onContentChange,
}: {
  content: ResumeContent;
  onContentChange: (content: ResumeContent) => void;
}) {
  const skillsRaw = content.skills;
  const entries: SkillEntry[] =
    content.skillEntries && content.skillEntries.length > 0
      ? content.skillEntries
      : !skillsRaw
        ? []
        : Array.isArray(skillsRaw)
          ? skillsRaw.map((s: string) => ({ label: s, subSkills: [] as string[] }))
          : Object.entries(skillsRaw).map(([label, subSkills]: [string, string[]]) => ({
              label,
              subSkills: subSkills ?? [],
            }));
  const [editingSkillIdx, setEditingSkillIdx] = useState<number | null>(null);
  const [editingExpIdx, setEditingExpIdx] = useState<number | null>(null);

  const setContent = (next: ResumeContent) => onContentChange(next);

  return (
    <div className="space-y-3 max-h-[520px] overflow-auto pr-1">
      <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
        <div className="flex items-center gap-2">
          <User className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-semibold uppercase tracking-wide">
            Profile / Title
          </span>
        </div>
        <Input
          value={content.profileTitle}
          onChange={(e) =>
            setContent({ ...content, profileTitle: e.target.value })
          }
          placeholder="e.g. Senior Software Engineer"
        />
      </div>
      <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-semibold uppercase tracking-wide">
            Professional Summary
          </span>
        </div>
        <Textarea
          className="min-h-[88px] text-sm"
          value={content.professionalSummary}
          onChange={(e) =>
            setContent({ ...content, professionalSummary: e.target.value })
          }
          placeholder="2–3 sentences"
        />
      </div>
      <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
        <div className="flex items-center gap-2">
          <Mail className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-semibold uppercase tracking-wide">
            Contact Info
          </span>
        </div>
        <Textarea
          className="min-h-[72px] text-sm"
          value={content.contactInfo ?? ""}
          onChange={(e) =>
            setContent({ ...content, contactInfo: e.target.value })
          }
          placeholder="Email, phone, location, links"
        />
      </div>
      <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-semibold uppercase tracking-wide">
            Technical Skills
          </span>
        </div>
        <div className="space-y-1">
          {(content.skillEntries ?? entries).map((e: SkillEntry, idx: number) => (
            <div
              key={idx}
              className="flex items-center gap-2 rounded border bg-background px-2 py-2 text-sm"
            >
              <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">
                {e.label || "(Untitled)"}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                onClick={() =>
                  setEditingSkillIdx(editingSkillIdx === idx ? null : idx)
                }
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                onClick={() => {
                  const list = [...(content.skillEntries ?? entries)];
                  list.splice(idx, 1);
                  setContent({
                    ...content,
                    skillEntries: list,
                    skills: Object.fromEntries(list.map((e) => [e.label, e.subSkills ?? []])),
                  });
                  if (editingSkillIdx === idx) setEditingSkillIdx(null);
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            const list = [...(content.skillEntries ?? entries), { label: "", subSkills: [] as string[] }];
            setContent({ ...content, skillEntries: list });
            setEditingSkillIdx(list.length - 1);
          }}
        >
          Add Entry
        </Button>
        {editingSkillIdx !== null &&
          (content.skillEntries ?? entries)[editingSkillIdx] != null && (
            <Card className="mt-2">
              <CardContent className="space-y-2 p-3">
                <Label>Skill</Label>
                <Input
                  value={(content.skillEntries ?? entries)[editingSkillIdx]?.label ?? ""}
                  onChange={(e) => {
                    const list = [...(content.skillEntries ?? entries)];
                    list[editingSkillIdx] = {
                      ...list[editingSkillIdx],
                      label: e.target.value,
                    };
                    setContent({
                      ...content,
                      skillEntries: list,
                      skills: Object.fromEntries(list.map((e) => [e.label, e.subSkills ?? []])),
                    });
                  }}
                />
                <Label>Sub-skills (one per line)</Label>
                <Textarea
                  className="min-h-[80px] text-sm"
                  value={
                    ((content.skillEntries ?? entries)[editingSkillIdx]?.subSkills ?? []).join("\n")
                  }
                  onChange={(e) => {
                    const sub = e.target.value.split("\n").map((s) => s.trim()).filter(Boolean);
                    const list = [...(content.skillEntries ?? entries)];
                    list[editingSkillIdx] = { ...list[editingSkillIdx], subSkills: sub };
                    setContent({
                      ...content,
                      skillEntries: list,
                      skills: Object.fromEntries(list.map((e) => [e.label, e.subSkills ?? []])),
                    });
                  }}
                />
                <Button type="button" size="sm" onClick={() => setEditingSkillIdx(null)}>
                  Done
                </Button>
              </CardContent>
            </Card>
          )}
      </div>
      <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
        <div className="flex items-center gap-2">
          <Briefcase className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-semibold uppercase tracking-wide">
            Professional Experience
          </span>
        </div>
        <div className="space-y-1">
          {(content.experience ?? []).map((exp, idx) => (
            <div
              key={idx}
              className="flex items-center gap-2 rounded border bg-background px-2 py-2 text-sm"
            >
              <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">
                {exp.jobTitle || "(No title)"}
                {exp.company ? ` · ${exp.company}` : ""}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                onClick={() =>
                  setEditingExpIdx(editingExpIdx === idx ? null : idx)
                }
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                onClick={() => {
                  const list = [...(content.experience ?? [])];
                  list.splice(idx, 1);
                  setContent({ ...content, experience: list });
                  if (editingExpIdx === idx) setEditingExpIdx(null);
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            setContent({
              ...content,
              experience: [
                ...(content.experience ?? []),
                {
                  jobTitle: "",
                  company: "",
                  location: "",
                  startDate: "",
                  endDate: "",
                  bullets: [],
                },
              ],
            })
          }
        >
          Add Entry
        </Button>
        {editingExpIdx !== null &&
          content.experience?.[editingExpIdx] != null && (
            <Card className="mt-2">
              <CardContent className="space-y-2 p-3">
                <Label>Job title</Label>
                <Input
                  value={content.experience[editingExpIdx]?.jobTitle ?? ""}
                  onChange={(e) => {
                    const list = [...content.experience!];
                    list[editingExpIdx] = {
                      ...list[editingExpIdx],
                      jobTitle: e.target.value,
                    };
                    setContent({ ...content, experience: list });
                  }}
                />
                <Label>Company</Label>
                <Input
                  value={content.experience[editingExpIdx]?.company ?? ""}
                  onChange={(e) => {
                    const list = [...content.experience!];
                    list[editingExpIdx] = {
                      ...list[editingExpIdx],
                      company: e.target.value,
                    };
                    setContent({ ...content, experience: list });
                  }}
                />
                <Label>Location</Label>
                <Input
                  placeholder="e.g. San Francisco, CA or Remote"
                  value={content.experience[editingExpIdx]?.location ?? ""}
                  onChange={(e) => {
                    const list = [...content.experience!];
                    list[editingExpIdx] = {
                      ...list[editingExpIdx],
                      location: e.target.value,
                    };
                    setContent({ ...content, experience: list });
                  }}
                />
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1.5">
                    <Label>Start date</Label>
                    <Input
                      placeholder="e.g. Jan 2020"
                      value={content.experience[editingExpIdx]?.startDate ?? ""}
                      onChange={(e) => {
                        const list = [...content.experience!];
                        list[editingExpIdx] = {
                          ...list[editingExpIdx],
                          startDate: e.target.value,
                        };
                        setContent({ ...content, experience: list });
                      }}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>End date</Label>
                    <Input
                      placeholder="e.g. Present or Dec 2023"
                      value={content.experience[editingExpIdx]?.endDate ?? ""}
                      onChange={(e) => {
                        const list = [...content.experience!];
                        list[editingExpIdx] = {
                          ...list[editingExpIdx],
                          endDate: e.target.value,
                        };
                        setContent({ ...content, experience: list });
                      }}
                    />
                  </div>
                </div>
                <Label>Bullets</Label>
                <Textarea
                  className="min-h-[80px] text-sm"
                  value={(content.experience[editingExpIdx]?.bullets ?? []).join("\n")}
                  onChange={(e) => {
                    const bullets = e.target.value
                      .split("\n")
                      .map((b) => b.trim())
                      .filter(Boolean);
                    const list = [...content.experience!];
                    list[editingExpIdx] = { ...list[editingExpIdx], bullets };
                    setContent({ ...content, experience: list });
                  }}
                />
                <Button type="button" size="sm" onClick={() => setEditingExpIdx(null)}>
                  Done
                </Button>
              </CardContent>
            </Card>
          )}
      </div>
    </div>
  );
}

export function ResumeDBPageClient() {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<UploadStatus>("idle");
  const [resumes, setResumes] = useState<ResumeRow[]>([]);
  const [isLoadingResumes, setIsLoadingResumes] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isParsingPreview, setIsParsingPreview] = useState(false);
  const [previewRoleTitle, setPreviewRoleTitle] = useState<string | null>(null);
  const [editorContent, setEditorContent] = useState<ResumeContent | null>(null);
  const [editorStructure, setEditorStructure] = useState<any | null>(null);
  const [parsedFileType, setParsedFileType] = useState<"pdf" | "docx" | null>(
    null,
  );
  const [viewJson, setViewJson] = useState<string | null>(null);
  const [viewResume, setViewResume] = useState<{
    id: number;
    file_name: string;
    file_type: string;
    content: ResumeContent;
    structure: unknown;
  } | null>(null);
  const [viewId, setViewId] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<"json" | "form">("json");
  const [isLoadingView, setIsLoadingView] = useState(false);
  const [isSavingView, setIsSavingView] = useState(false);
  const [editingSkillIndex, setEditingSkillIndex] = useState<number | null>(
    null,
  );
  const [skillsSectionCollapsed, setSkillsSectionCollapsed] = useState(false);
  const [skillsHeading, setSkillsHeading] = useState("TECHNICAL SKILLS");
  const [profileHeading, setProfileHeading] = useState("PROFILE / TITLE");
  const [profileCollapsed, setProfileCollapsed] = useState(false);
  const [summaryHeading, setSummaryHeading] = useState("PROFESSIONAL SUMMARY");
  const [summaryCollapsed, setSummaryCollapsed] = useState(false);
  const [contactHeading, setContactHeading] = useState("CONTACT INFO");
  const [contactCollapsed, setContactCollapsed] = useState(false);
  const [experienceHeading, setExperienceHeading] = useState(
    "PROFESSIONAL EXPERIENCE",
  );
  const [experienceCollapsed, setExperienceCollapsed] = useState(false);
  const [editingExpIndex, setEditingExpIndex] = useState<number | null>(null);
  const [uploadSectionCollapsed, setUploadSectionCollapsed] = useState(false);
  const [uploadHeading, setUploadHeading] = useState("RESUME FILE");
  const profileHeadingRef = React.useRef<HTMLInputElement>(null);
  const summaryHeadingRef = React.useRef<HTMLInputElement>(null);
  const contactHeadingRef = React.useRef<HTMLInputElement>(null);
  const experienceHeadingRef = React.useRef<HTMLInputElement>(null);
  const skillsHeadingRef = React.useRef<HTMLInputElement>(null);
  const uploadHeadingRef = React.useRef<HTMLInputElement>(null);
  const [addResumeMethod, setAddResumeMethod] =
    useState<AddResumeMethod>("choose");

  const loadResumes = async () => {
    setIsLoadingResumes(true);
    try {
      const response = await fetch("/api/resume-db");
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage =
          errorData.error || "Failed to load resumes from database.";
        throw new Error(errorMessage);
      }
      const data = await response.json();
      setResumes(data.resumes ?? []);
    } catch (error) {
      console.error("Error loading resumes:", error);
      const message =
        error instanceof Error ? error.message : "Failed to load resumes.";
      toast.error(message);
    } finally {
      setIsLoadingResumes(false);
    }
  };

  useEffect(() => {
    loadResumes();
  }, []);

  const handleViewResume = async (id: number) => {
    setIsLoadingView(true);
    setViewJson(null);
    setViewResume(null);
    setViewId(id);
    setViewMode("json");

    try {
      const response = await fetch(`/api/resume-db?id=${id}`);
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage =
          errorData.error || "Failed to load resume.";
        throw new Error(errorMessage);
      }

      const data = await response.json();
      const resume = data.resume;
      setViewResume(resume);
      setViewJson(JSON.stringify(resume, null, 2));
    } catch (error) {
      console.error("Error loading resume:", error);
      const message =
        error instanceof Error ? error.message : "Failed to load resume.";
      toast.error(message);
      setViewJson(null);
      setViewResume(null);
    } finally {
      setIsLoadingView(false);
    }
  };

  const [removingId, setRemovingId] = useState<number | null>(null);

  const handleRemoveResume = async (id: number) => {
    if (!confirm("Remove this resume from the database? This cannot be undone.")) {
      return;
    }
    setRemovingId(id);
    try {
      const res = await fetch(`/api/resume-db?id=${id}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Failed to remove resume");
      }
      toast.success("Resume removed.");
      if (viewId === id) {
        setViewId(null);
        setViewJson(null);
        setViewResume(null);
      }
      loadResumes();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to remove resume");
    } finally {
      setRemovingId(null);
    }
  };

  const handleSaveViewResume = async () => {
    if (!viewResume) return;
    const content = viewResume.content;
    const entries = content.skillEntries ?? [];
    const skillsObj =
      entries.length > 0
        ? Object.fromEntries(entries.map((e) => [e.label, e.subSkills ?? []]))
        : (Array.isArray(content.skills) ? {} : content.skills ?? {});
    const contentToSave: ResumeContent = {
      ...content,
      skillEntries: entries,
      skills: skillsObj,
    };
    setIsSavingView(true);
    try {
      const res = await fetch("/api/resume-db", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: viewResume.id,
          content: contentToSave,
          structure: viewResume.structure,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Failed to save");
      }
      toast.success("Resume updated.");
      setViewResume((prev) =>
        prev ? { ...prev, content: contentToSave } : null,
      );
      setViewJson(JSON.stringify({ ...viewResume, content: contentToSave }, null, 2));
      loadResumes();
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Failed to update resume.",
      );
    } finally {
      setIsSavingView(false);
    }
  };

  const handleParsePreview = async () => {
    if (!file) {
      toast.error("Please select a resume file first.");
      return;
    }

    const extension = file.name.split(".").pop()?.toLowerCase();
    if (!extension || !["pdf", "docx"].includes(extension)) {
      toast.error("Please upload a PDF or DOCX file.");
      return;
    }

    const maxSize = 5 * 1024 * 1024; // 5MB
    if (file.size > maxSize) {
      const maxSizeMB = (maxSize / (1024 * 1024)).toFixed(0);
      toast.error(`File size must be less than ${maxSizeMB}MB.`);
      return;
    }

    setIsParsingPreview(true);
    setPreviewRoleTitle(null);
    setEditorContent(null);
    setEditorStructure(null);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/resume-parse-structure", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage =
          errorData.error || "Failed to parse resume for preview.";
        throw new Error(errorMessage);
      }

      const result = await response.json();
      const content: ResumeContent | undefined = result.content;
      const structure = result.structure;

      if (!content || !structure) {
        throw new Error("Invalid parse result: missing content or structure.");
      }

      setEditorContent(normalizeSkillEntries(content));
      setEditorStructure(structure);
      setParsedFileType(extension === "pdf" ? "pdf" : "docx");

      const title = content.profileTitle ?? "";
      setPreviewRoleTitle(title || "(no title detected)");
      toast.success("Resume parsed. Review and edit before saving.");
    } catch (error) {
      console.error("Error parsing resume preview:", error);
      const message =
        error instanceof Error ? error.message : "Failed to parse resume.";
      toast.error(message);
    } finally {
      setIsParsingPreview(false);
    }
  };

  const handleUpload = async () => {
    const isManual = addResumeMethod === "manual";
    if (!isManual && !file) {
      toast.error("Please select a resume file first.");
      return;
    }

    if (!editorContent || !editorStructure) {
      toast.error(
        isManual
          ? "Resume content is missing."
          : "Please parse the resume and wait for the editor to load.",
      );
      return;
    }

    setStatus("uploading");

    try {
      const entries = editorContent.skillEntries ?? [];
      const skillsObj =
        entries.length > 0
          ? Object.fromEntries(entries.map((e) => [e.label, e.subSkills ?? []]))
          : (Array.isArray(editorContent.skills)
              ? {}
              : editorContent.skills ?? {});
      const contentToSave: ResumeContent = {
        ...editorContent,
        skillEntries: entries,
        skills: skillsObj,
      };

      const response = await fetch("/api/resume-db", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fileName: file?.name ?? "manual-resume.json",
          fileType: parsedFileType ?? "pdf",
          content: contentToSave,
          structure: editorStructure,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage =
          errorData.error || "Failed to add resume to database.";
        throw new Error(errorMessage);
      }

      await response.json();
      setStatus("success");
      toast.success("Resume added to database as JSON.");
      setFile(null);
      setAddResumeMethod("choose");
      setIsDialogOpen(false);
      loadResumes();
    } catch (error) {
      console.error("Error uploading resume to DB:", error);
      const message =
        error instanceof Error ? error.message : "Failed to add resume.";
      toast.error(message);
      setStatus("error");
    } finally {
      setStatus((prev) => (prev === "uploading" ? "idle" : prev));
    }
  };

  return (
    <JobsLayout>
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-3xl font-bold">Resume DB</h1>
          <Dialog
            open={isDialogOpen}
            onOpenChange={(open) => {
              setIsDialogOpen(open);
              if (!open) setAddResumeMethod("choose");
            }}
          >
            <DialogTrigger asChild>
              <Button>
                <Upload className="h-4 w-4 mr-2" />
                Add resume
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-6xl max-h-[90vh] flex flex-col">
              <DialogHeader>
                <DialogTitle>Add Resume</DialogTitle>
                <DialogDescription>
                  {addResumeMethod === "choose" &&
                    "Choose how you want to add a resume."}
                  {addResumeMethod === "parse" &&
                    "Upload a PDF or DOCX file to parse into structured JSON, then edit and save."}
                  {addResumeMethod === "manual" &&
                    "Fill in your resume details from scratch and save."}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3 mt-2 flex-1 min-h-0 overflow-auto">
                {/* Method choice */}
                {addResumeMethod === "choose" && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 py-4">
                    <Button
                      type="button"
                      variant="outline"
                      className="h-auto flex flex-col items-stretch gap-3 p-6 text-left"
                      onClick={() => setAddResumeMethod("parse")}
                    >
                      <span className="flex items-center gap-2 font-semibold">
                        <Upload className="h-5 w-5" />
                        Parse from resume file
                      </span>
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-auto flex flex-col items-stretch gap-3 p-6 text-left"
                      onClick={() => {
                        setAddResumeMethod("manual");
                        setEditorContent(EMPTY_RESUME_CONTENT);
                        setEditorStructure(EMPTY_RESUME_STRUCTURE);
                        setParsedFileType("pdf");
                      }}
                    >
                      <span className="flex items-center gap-2 font-semibold">
                        <Pencil className="h-5 w-5" />
                        Manual edit only
                      </span>
                    </Button>
                  </div>
                )}

                {/* Upload section card - only when parse method */}
                {addResumeMethod === "parse" && (
                  <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-muted-foreground shrink-0">
                        <Upload className="h-4 w-4" />
                      </span>
                      <input
                        className="flex-1 min-w-0 bg-transparent text-sm font-semibold uppercase tracking-wide outline-none"
                        value={uploadHeading}
                        onChange={(e) =>
                          setUploadHeading(
                            e.target.value || "RESUME FILE",
                          )
                        }
                      />
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0"
                      onClick={() =>
                        setUploadSectionCollapsed(!uploadSectionCollapsed)
                      }
                    >
                      {uploadSectionCollapsed ? (
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronUp className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                  {!uploadSectionCollapsed && (
                    <>
                      <div className="flex items-center gap-3">
                        <Input
                          id="resume-file"
                          type="file"
                          accept=".pdf,.docx"
                          onChange={(e) => {
                            const selected = e.target.files?.[0] || null;
                            setFile(selected);
                            if (selected) {
                              setStatus("idle");
                              setPreviewRoleTitle(null);
                            }
                          }}
                        />
                        {file && (
                          <div className="flex items-center gap-1 text-sm text-muted-foreground min-w-0">
                            <FileText className="h-4 w-4 shrink-0" />
                            <span className="truncate max-w-[180px]">
                              {file.name}
                            </span>
                          </div>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Accepted: PDF, DOCX (Max 5MB).
                      </p>
                      {previewRoleTitle && (
                        <p className="text-xs text-muted-foreground mt-1">
                          Detected role title:{" "}
                          <span className="font-medium">{previewRoleTitle}</span>
                        </p>
                      )}
                    </>
                  )}
                </div>
                )}

                {(addResumeMethod === "parse" && editorContent) ||
                (addResumeMethod === "manual" && editorContent) ? (
                  <>
                    {addResumeMethod === "parse" && (
                      <Separator className="my-2" />
                    )}
                    <div className="space-y-3 max-h-[520px] overflow-auto pr-1">
                      {/* Profile / Title section */}
                      <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-muted-foreground shrink-0">
                              <User className="h-4 w-4" />
                            </span>
                            <input
                              ref={profileHeadingRef}
                              className="flex-1 min-w-0 bg-transparent text-sm font-semibold uppercase tracking-wide outline-none"
                              value={profileHeading}
                              onChange={(e) =>
                                setProfileHeading(
                                  e.target.value || "PROFILE / TITLE",
                                )
                              }
                            />
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-7 text-xs shrink-0"
                              onClick={() => profileHeadingRef.current?.focus()}
                            >
                              <Pencil className="h-3 w-3 mr-1" />
                              Edit Heading
                            </Button>
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 shrink-0"
                            onClick={() =>
                              setProfileCollapsed(!profileCollapsed)
                            }
                          >
                            {profileCollapsed ? (
                              <ChevronDown className="h-4 w-4" />
                            ) : (
                              <ChevronUp className="h-4 w-4" />
                            )}
                          </Button>
                        </div>
                        {!profileCollapsed && (
                          <Input
                            placeholder="e.g. Senior Software Engineer"
                            value={editorContent.profileTitle}
                            onChange={(e) =>
                              setEditorContent({
                                ...editorContent,
                                profileTitle: e.target.value,
                              })
                            }
                          />
                        )}
                      </div>

                      {/* Professional Summary section */}
                      <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-muted-foreground shrink-0">
                              <FileText className="h-4 w-4" />
                            </span>
                            <input
                              ref={summaryHeadingRef}
                              className="flex-1 min-w-0 bg-transparent text-sm font-semibold uppercase tracking-wide outline-none"
                              value={summaryHeading}
                              onChange={(e) =>
                                setSummaryHeading(
                                  e.target.value || "PROFESSIONAL SUMMARY",
                                )
                              }
                            />
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-7 text-xs shrink-0"
                              onClick={() => summaryHeadingRef.current?.focus()}
                            >
                              <Pencil className="h-3 w-3 mr-1" />
                              Edit Heading
                            </Button>
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 shrink-0"
                            onClick={() =>
                              setSummaryCollapsed(!summaryCollapsed)
                            }
                          >
                            {summaryCollapsed ? (
                              <ChevronDown className="h-4 w-4" />
                            ) : (
                              <ChevronUp className="h-4 w-4" />
                            )}
                          </Button>
                        </div>
                        {!summaryCollapsed && (
                          <Textarea
                            className="min-h-[88px] text-sm"
                            placeholder="2–3 sentences about your experience and goals"
                            value={editorContent.professionalSummary}
                            onChange={(e) =>
                              setEditorContent({
                                ...editorContent,
                                professionalSummary: e.target.value,
                              })
                            }
                          />
                        )}
                      </div>

                      {/* Contact Info section */}
                      <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-muted-foreground shrink-0">
                              <Mail className="h-4 w-4" />
                            </span>
                            <input
                              ref={contactHeadingRef}
                              className="flex-1 min-w-0 bg-transparent text-sm font-semibold uppercase tracking-wide outline-none"
                              value={contactHeading}
                              onChange={(e) =>
                                setContactHeading(
                                  e.target.value || "CONTACT INFO",
                                )
                              }
                            />
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-7 text-xs shrink-0"
                              onClick={() => contactHeadingRef.current?.focus()}
                            >
                              <Pencil className="h-3 w-3 mr-1" />
                              Edit Heading
                            </Button>
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 shrink-0"
                            onClick={() =>
                              setContactCollapsed(!contactCollapsed)
                            }
                          >
                            {contactCollapsed ? (
                              <ChevronDown className="h-4 w-4" />
                            ) : (
                              <ChevronUp className="h-4 w-4" />
                            )}
                          </Button>
                        </div>
                        {!contactCollapsed && (
                          <Textarea
                            className="min-h-[72px] text-sm"
                            placeholder={"Email\nPhone\nLocation\nLinks"}
                            value={editorContent.contactInfo ?? ""}
                            onChange={(e) =>
                              setEditorContent({
                                ...editorContent,
                                contactInfo: e.target.value,
                              })
                            }
                          />
                        )}
                      </div>

                      {/* Technical Skills (FlowCV-style) */}
                      <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="text-muted-foreground">
                              <Sparkles className="h-4 w-4" />
                            </span>
                            <input
                              ref={skillsHeadingRef}
                              className="flex-1 bg-transparent text-sm font-semibold uppercase tracking-wide outline-none"
                              value={skillsHeading}
                              onChange={(e) =>
                                setSkillsHeading(e.target.value || "TECHNICAL SKILLS")
                              }
                            />
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-7 text-xs"
                              onClick={() => skillsHeadingRef.current?.focus()}
                            >
                              <Pencil className="h-3 w-3 mr-1" />
                              Edit Heading
                            </Button>
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() =>
                              setSkillsSectionCollapsed(!skillsSectionCollapsed)
                            }
                          >
                            {skillsSectionCollapsed ? (
                              <ChevronDown className="h-4 w-4" />
                            ) : (
                              <ChevronUp className="h-4 w-4" />
                            )}
                          </Button>
                        </div>

                        {!skillsSectionCollapsed && (
                          <>
                            <div className="space-y-1">
                              {(editorContent.skillEntries ?? []).map(
                                (entry, idx) => (
                                  <div
                                    key={idx}
                                    className="flex items-center gap-2 rounded border bg-background px-2 py-2 text-sm"
                                  >
                                    <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground" />
                                    <span className="min-w-0 flex-1 truncate">
                                      {entry.label || "(Untitled)"}
                                    </span>
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon"
                                      className="h-7 w-7 shrink-0"
                                      onClick={() =>
                                        setEditingSkillIndex(
                                          editingSkillIndex === idx ? null : idx,
                                        )
                                      }
                                      title="Edit entry"
                                    >
                                      <Pencil className="h-3.5 w-3.5" />
                                    </Button>
                                  </div>
                                ),
                              )}
                            </div>

                            <div className="flex flex-wrap items-center gap-2 pt-1">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-8 text-xs"
                                onClick={() => {
                                  const entries = [
                                    ...(editorContent.skillEntries ?? []),
                                    { label: "", subSkills: [] as string[] },
                                  ];
                                  setEditorContent({
                                    ...editorContent,
                                    skillEntries: entries,
                                  });
                                  setEditingSkillIndex(entries.length - 1);
                                }}
                              >
                                Add Entry
                              </Button>
                              <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                className="h-8 text-xs"
                                disabled
                                title="Coming soon"
                              >
                                <Sparkles className="h-3.5 w-3.5 mr-1" />
                                AI Skill Suggestions
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-muted-foreground"
                                onClick={() => {
                                  setEditorContent({
                                    ...editorContent,
                                    skillEntries: [],
                                  });
                                  setEditingSkillIndex(null);
                                }}
                                title="Remove section"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>

                            {/* Edit Entry panel */}
                            {editingSkillIndex !== null &&
                              editorContent.skillEntries?.[editingSkillIndex] != null && (
                                <Card className="mt-3">
                                  <CardHeader className="py-2 px-3">
                                    <div className="flex items-center justify-between">
                                      <span className="text-sm font-semibold">
                                        Edit Entry
                                      </span>
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        onClick={() =>
                                          setEditingSkillIndex(null)
                                        }
                                      >
                                        Done
                                      </Button>
                                    </div>
                                  </CardHeader>
                                  <CardContent className="space-y-3 px-3 pb-3">
                                    <div className="space-y-1.5">
                                      <Label>Skill</Label>
                                      <Input
                                        placeholder="e.g. Agentic AI & LLM Systems"
                                        value={
                                          editorContent.skillEntries[
                                            editingSkillIndex
                                          ]?.label ?? ""
                                        }
                                        onChange={(e) => {
                                          const next = [
                                            ...(editorContent.skillEntries ?? []),
                                          ];
                                          next[editingSkillIndex] = {
                                            ...next[editingSkillIndex],
                                            label: e.target.value,
                                          };
                                          setEditorContent({
                                            ...editorContent,
                                            skillEntries: next,
                                          });
                                        }}
                                      />
                                    </div>
                                    <div className="space-y-1.5">
                                      <Label>
                                        Information / Sub-skills
                                      </Label>
                                      <Textarea
                                        placeholder="One per line or comma-separated"
                                        className="min-h-[100px] text-sm"
                                        value={
                                          (
                                            editorContent.skillEntries[
                                              editingSkillIndex
                                            ]?.subSkills ?? []
                                          ).join("\n")
                                        }
                                        onChange={(e) => {
                                          const subSkills = e.target.value
                                            .split(/[\n,]/)
                                            .map((s) => s.trim())
                                            .filter(Boolean);
                                          const next = [
                                            ...(editorContent.skillEntries ?? []),
                                          ];
                                          next[editingSkillIndex] = {
                                            ...next[editingSkillIndex],
                                            subSkills,
                                          };
                                          setEditorContent({
                                            ...editorContent,
                                            skillEntries: next,
                                          });
                                        }}
                                      />
                                    </div>
                                    <div className="space-y-1.5">
                                      <Label>Skill level</Label>
                                      <Select
                                        value={
                                          editorContent.skillEntries[
                                            editingSkillIndex
                                          ]?.level || undefined
                                        }
                                        onValueChange={(value) => {
                                          const next = [
                                            ...(editorContent.skillEntries ?? []),
                                          ];
                                          next[editingSkillIndex] = {
                                            ...next[editingSkillIndex],
                                            level: value,
                                          };
                                          setEditorContent({
                                            ...editorContent,
                                            skillEntries: next,
                                          });
                                        }}
                                      >
                                        <SelectTrigger className="w-full">
                                          <SelectValue placeholder="Select skill level" />
                                        </SelectTrigger>
                                        <SelectContent>
                                          <SelectItem value="beginner">
                                            Beginner
                                          </SelectItem>
                                          <SelectItem value="intermediate">
                                            Intermediate
                                          </SelectItem>
                                          <SelectItem value="advanced">
                                            Advanced
                                          </SelectItem>
                                          <SelectItem value="expert">
                                            Expert
                                          </SelectItem>
                                        </SelectContent>
                                      </Select>
                                    </div>
                                    <Button
                                      type="button"
                                      className="w-full"
                                      onClick={() =>
                                        setEditingSkillIndex(null)
                                      }
                                    >
                                      Done
                                    </Button>
                                  </CardContent>
                                </Card>
                              )}
                          </>
                        )}
                      </div>

                      {/* Professional Experience section */}
                      <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-muted-foreground shrink-0">
                              <Briefcase className="h-4 w-4" />
                            </span>
                            <input
                              ref={experienceHeadingRef}
                              className="flex-1 min-w-0 bg-transparent text-sm font-semibold uppercase tracking-wide outline-none"
                              value={experienceHeading}
                              onChange={(e) =>
                                setExperienceHeading(
                                  e.target.value ||
                                    "PROFESSIONAL EXPERIENCE",
                                )
                              }
                            />
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-7 text-xs shrink-0"
                              onClick={() => experienceHeadingRef.current?.focus()}
                            >
                              <Pencil className="h-3 w-3 mr-1" />
                              Edit Heading
                            </Button>
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 shrink-0"
                            onClick={() =>
                              setExperienceCollapsed(!experienceCollapsed)
                            }
                          >
                            {experienceCollapsed ? (
                              <ChevronDown className="h-4 w-4" />
                            ) : (
                              <ChevronUp className="h-4 w-4" />
                            )}
                          </Button>
                        </div>

                        {!experienceCollapsed && (
                          <>
                            <div className="space-y-1">
                              {editorContent.experience.map((exp, idx) => (
                                <div
                                  key={idx}
                                  className="flex items-center gap-2 rounded border bg-background px-2 py-2 text-sm"
                                >
                                  <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground" />
                                  <span className="min-w-0 flex-1 truncate">
                                    {exp.jobTitle || "(No title)"}
                                    {exp.company ? ` · ${exp.company}` : ""}
                                  </span>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 shrink-0"
                                    onClick={() =>
                                      setEditingExpIndex(
                                        editingExpIndex === idx ? null : idx,
                                      )
                                    }
                                    title="Edit entry"
                                  >
                                    <Pencil className="h-3.5 w-3.5" />
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 shrink-0 text-muted-foreground"
                                    onClick={() => {
                                      const next = [
                                        ...editorContent.experience,
                                      ];
                                      next.splice(idx, 1);
                                      setEditorContent({
                                        ...editorContent,
                                        experience: next,
                                      });
                                      if (editingExpIndex === idx)
                                        setEditingExpIndex(null);
                                      else if (
                                        editingExpIndex != null &&
                                        editingExpIndex > idx
                                      )
                                        setEditingExpIndex(editingExpIndex - 1);
                                    }}
                                    title="Remove"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                                </div>
                              ))}
                            </div>

                            <div className="flex flex-wrap items-center gap-2 pt-1">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-8 text-xs"
                                onClick={() => {
                                  const next = [
                                    ...editorContent.experience,
                                    {
                                      jobTitle: "",
                                      company: "",
                                      location: "",
                                      startDate: "",
                                      endDate: "",
                                      bullets: [] as string[],
                                    },
                                  ];
                                  setEditorContent({
                                    ...editorContent,
                                    experience: next,
                                  });
                                  setEditingExpIndex(next.length - 1);
                                }}
                              >
                                Add Entry
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-muted-foreground"
                                onClick={() => {
                                  setEditorContent({
                                    ...editorContent,
                                    experience: [],
                                  });
                                  setEditingExpIndex(null);
                                }}
                                title="Remove section"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>

                            {editingExpIndex !== null &&
                              editorContent.experience[editingExpIndex] != null && (
                                <Card className="mt-3">
                                  <CardHeader className="py-2 px-3">
                                    <div className="flex items-center justify-between">
                                      <span className="text-sm font-semibold">
                                        Edit Entry
                                      </span>
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        onClick={() =>
                                          setEditingExpIndex(null)
                                        }
                                      >
                                        Done
                                      </Button>
                                    </div>
                                  </CardHeader>
                                  <CardContent className="space-y-3 px-3 pb-3">
                                    <div className="space-y-1.5">
                                      <Label>Job title</Label>
                                      <Input
                                        placeholder="e.g. Senior Engineer"
                                        value={
                                          editorContent.experience[
                                            editingExpIndex
                                          ]?.jobTitle ?? ""
                                        }
                                        onChange={(e) => {
                                          const next = [
                                            ...editorContent.experience,
                                          ];
                                          next[editingExpIndex] = {
                                            ...next[editingExpIndex],
                                            jobTitle: e.target.value,
                                          };
                                          setEditorContent({
                                            ...editorContent,
                                            experience: next,
                                          });
                                        }}
                                      />
                                    </div>
                                    <div className="space-y-1.5">
                                      <Label>Company</Label>
                                      <Input
                                        placeholder="e.g. Acme Inc."
                                        value={
                                          editorContent.experience[
                                            editingExpIndex
                                          ]?.company ?? ""
                                        }
                                        onChange={(e) => {
                                          const next = [
                                            ...editorContent.experience,
                                          ];
                                          next[editingExpIndex] = {
                                            ...next[editingExpIndex],
                                            company: e.target.value,
                                          };
                                          setEditorContent({
                                            ...editorContent,
                                            experience: next,
                                          });
                                        }}
                                      />
                                    </div>
                                    <div className="space-y-1.5">
                                      <Label>Location</Label>
                                      <Input
                                        placeholder="e.g. San Francisco, CA or Remote"
                                        value={
                                          editorContent.experience[
                                            editingExpIndex
                                          ]?.location ?? ""
                                        }
                                        onChange={(e) => {
                                          const next = [
                                            ...editorContent.experience,
                                          ];
                                          next[editingExpIndex] = {
                                            ...next[editingExpIndex],
                                            location: e.target.value,
                                          };
                                          setEditorContent({
                                            ...editorContent,
                                            experience: next,
                                          });
                                        }}
                                      />
                                    </div>
                                    <div className="grid grid-cols-2 gap-2">
                                      <div className="space-y-1.5">
                                        <Label>Start date</Label>
                                        <Input
                                          placeholder="e.g. Jan 2020"
                                          value={
                                            editorContent.experience[
                                              editingExpIndex
                                            ]?.startDate ?? ""
                                          }
                                          onChange={(e) => {
                                            const next = [
                                              ...editorContent.experience,
                                            ];
                                            next[editingExpIndex] = {
                                              ...next[editingExpIndex],
                                              startDate: e.target.value,
                                            };
                                            setEditorContent({
                                              ...editorContent,
                                              experience: next,
                                            });
                                          }}
                                        />
                                      </div>
                                      <div className="space-y-1.5">
                                        <Label>End date</Label>
                                        <Input
                                          placeholder="e.g. Present or Dec 2023"
                                          value={
                                            editorContent.experience[
                                              editingExpIndex
                                            ]?.endDate ?? ""
                                          }
                                          onChange={(e) => {
                                            const next = [
                                              ...editorContent.experience,
                                            ];
                                            next[editingExpIndex] = {
                                              ...next[editingExpIndex],
                                              endDate: e.target.value,
                                            };
                                            setEditorContent({
                                              ...editorContent,
                                              experience: next,
                                            });
                                          }}
                                        />
                                      </div>
                                    </div>
                                    <div className="space-y-1.5">
                                      <Label>Bullets</Label>
                                      <Textarea
                                        placeholder={"Achievement 1\nAchievement 2"}
                                        className="min-h-[88px] text-sm"
                                        value={
                                          (
                                            editorContent.experience[
                                              editingExpIndex
                                            ]?.bullets ?? []
                                          ).join("\n")
                                        }
                                        onChange={(e) => {
                                          const bullets = e.target.value
                                            .split("\n")
                                            .map((b) => b.trim())
                                            .filter(Boolean);
                                          const next = [
                                            ...editorContent.experience,
                                          ];
                                          next[editingExpIndex] = {
                                            ...next[editingExpIndex],
                                            bullets,
                                          };
                                          setEditorContent({
                                            ...editorContent,
                                            experience: next,
                                          });
                                        }}
                                      />
                                    </div>
                                    <Button
                                      type="button"
                                      className="w-full"
                                      onClick={() =>
                                        setEditingExpIndex(null)
                                      }
                                    >
                                      Done
                                    </Button>
                                  </CardContent>
                                </Card>
                              )}
                          </>
                        )}
                      </div>
                    </div>
                  </>
                ) : null}
              </div>
              {addResumeMethod !== "choose" && (
              <DialogFooter className="flex-row gap-2 justify-between border-t pt-3 mt-3">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setAddResumeMethod("choose");
                    setEditorContent(null);
                    setFile(null);
                  }}
                >
                  Back
                </Button>
                <div className="flex gap-2 ml-auto">
                {addResumeMethod === "parse" && !editorContent && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleParsePreview}
                    disabled={isParsingPreview || !file}
                  >
                    {isParsingPreview ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Parsing...
                      </>
                    ) : (
                      <>
                        <Upload className="h-4 w-4 mr-2" />
                        Parse resume
                      </>
                    )}
                  </Button>
                )}
                {((addResumeMethod === "parse" && editorContent) ||
                  addResumeMethod === "manual") && (
                  <Button
                    onClick={handleUpload}
                    disabled={
                      status === "uploading" ||
                      !editorContent ||
                      !editorContent.profileTitle.trim() ||
                      isParsingPreview
                    }
                  >
                    {status === "uploading" ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="h-4 w-4 mr-2" />
                        Confirm & save
                      </>
                    )}
                  </Button>
                )}
                </div>
              </DialogFooter>
              )}
            </DialogContent>
          </Dialog>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Registered Resumes</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoadingResumes ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Loading resumes...</span>
              </div>
            ) : resumes.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No resumes registered yet.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left border-b">
                    <tr>
                      <th className="py-2 pr-4">ID</th>
                      <th className="py-2 pr-4">Role (Title)</th>
                      <th className="py-2">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resumes.map((resume) => (
                      <tr key={resume.id} className="border-b last:border-0">
                        <td className="py-2 pr-4">{resume.id}</td>
                        <td className="py-2 pr-4">
                          {resume.roleTitle || (
                            <span className="text-muted-foreground">
                              (no title)
                            </span>
                          )}
                        </td>
                        <td className="py-2">
                          <div className="flex items-center gap-2">
                            <Dialog
                              open={
                                viewId === resume.id &&
                                (isLoadingView || viewResume !== null)
                              }
                              onOpenChange={(open) => {
                                if (!open) {
                                  setViewId(null);
                                  setViewJson(null);
                                  setViewResume(null);
                                } else {
                                  handleViewResume(resume.id);
                                }
                              }}
                            >
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleViewResume(resume.id)}
                              >
                                View
                              </Button>
                            <DialogContent className="max-w-6xl max-h-[90vh] flex flex-col">
                              <DialogHeader>
                                <DialogTitle>
                                  Resume (ID {resume.id})
                                  {viewResume?.file_name && (
                                    <span className="text-muted-foreground font-normal text-sm ml-2">
                                      {viewResume.file_name}
                                    </span>
                                  )}
                                </DialogTitle>
                              </DialogHeader>
                              <div className="flex gap-2 border-b pb-2">
                                <Button
                                  type="button"
                                  variant={viewMode === "json" ? "secondary" : "ghost"}
                                  size="sm"
                                  onClick={() => setViewMode("json")}
                                >
                                  JSON format
                                </Button>
                                <Button
                                  type="button"
                                  variant={viewMode === "form" ? "secondary" : "ghost"}
                                  size="sm"
                                  onClick={() => setViewMode("form")}
                                >
                                  Form view (Add Resume UI)
                                </Button>
                              </div>
                              <div className="mt-2 flex-1 min-h-0 overflow-auto">
                                {isLoadingView && viewId === resume.id ? (
                                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    <span>Loading...</span>
                                  </div>
                                ) : viewMode === "json" && viewJson ? (
                                  <pre className="max-h-[480px] overflow-auto rounded bg-muted p-3 text-xs whitespace-pre-wrap break-words">
                                    {viewJson}
                                  </pre>
                                ) : viewMode === "form" && viewResume?.content ? (
                                  <ResumeFormView
                                    content={normalizeSkillEntries(
                                      viewResume.content,
                                    )}
                                    onContentChange={(c) =>
                                      setViewResume((prev) =>
                                        prev ? { ...prev, content: c } : null,
                                      )
                                    }
                                  />
                                ) : (
                                  <p className="text-sm text-muted-foreground">
                                    No content to display.
                                  </p>
                                )}
                              </div>
                              {viewMode === "form" && viewResume && (
                                <DialogFooter className="border-t pt-3 mt-3">
                                  <Button
                                    onClick={handleSaveViewResume}
                                    disabled={isSavingView}
                                  >
                                    {isSavingView ? (
                                      <>
                                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                        Saving...
                                      </>
                                    ) : (
                                      <>
                                        <CheckCircle2 className="h-4 w-4 mr-2" />
                                        Save changes
                                      </>
                                    )}
                                  </Button>
                                </DialogFooter>
                              )}
                            </DialogContent>
                          </Dialog>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive hover:text-destructive"
                              onClick={() => handleRemoveResume(resume.id)}
                              disabled={removingId === resume.id}
                              title="Remove resume"
                            >
                              {removingId === resume.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Trash2 className="h-4 w-4" />
                              )}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </JobsLayout>
  );
}

