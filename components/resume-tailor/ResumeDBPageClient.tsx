"use client";

import React, { useCallback, useEffect, useState } from "react";
import JobsLayout from "@/app/jobs-layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ExternalLink,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

type ResumeDbRow = {
  rowIndex: number;
  candidate: string;
  email: string;
  jobLink: string;
  apply: string;
  jobTitle: string;
  company: string;
  resumeUrl: string;
  date: string;
};

const EMPTY_FORM: Omit<ResumeDbRow, "rowIndex"> = {
  candidate: "",
  email: "",
  jobLink: "",
  apply: "",
  jobTitle: "",
  company: "",
  resumeUrl: "",
  date: "",
};

function formatToday(): string {
  const d = new Date();
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function EntryForm({
  values,
  onChange,
  idPrefix,
}: {
  values: Omit<ResumeDbRow, "rowIndex">;
  onChange: (values: Omit<ResumeDbRow, "rowIndex">) => void;
  idPrefix: string;
}) {
  const set = (key: keyof Omit<ResumeDbRow, "rowIndex">, value: string) =>
    onChange({ ...values, [key]: value });

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-candidate`}>Candidate</Label>
        <Input
          id={`${idPrefix}-candidate`}
          value={values.candidate}
          onChange={(e) => set("candidate", e.target.value)}
          placeholder="Candidate name"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-email`}>Email</Label>
        <Input
          id={`${idPrefix}-email`}
          type="email"
          value={values.email}
          onChange={(e) => set("email", e.target.value)}
          placeholder="email@example.com"
        />
      </div>
      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor={`${idPrefix}-jobLink`}>Job link</Label>
        <Input
          id={`${idPrefix}-jobLink`}
          value={values.jobLink}
          onChange={(e) => set("jobLink", e.target.value)}
          placeholder="https://..."
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-apply`}>Apply</Label>
        <Input
          id={`${idPrefix}-apply`}
          value={values.apply}
          onChange={(e) => set("apply", e.target.value)}
          placeholder="Applied / Pending / etc."
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-date`}>Date</Label>
        <Input
          id={`${idPrefix}-date`}
          value={values.date}
          onChange={(e) => set("date", e.target.value)}
          placeholder="M/DD"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-jobTitle`}>Job title</Label>
        <Input
          id={`${idPrefix}-jobTitle`}
          value={values.jobTitle}
          onChange={(e) => set("jobTitle", e.target.value)}
          placeholder="e.g. Backend Software Engineer"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-company`}>Company</Label>
        <Input
          id={`${idPrefix}-company`}
          value={values.company}
          onChange={(e) => set("company", e.target.value)}
          placeholder="Company name"
        />
      </div>
      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor={`${idPrefix}-resumeUrl`}>resume_url (Google Drive)</Label>
        <Input
          id={`${idPrefix}-resumeUrl`}
          value={values.resumeUrl}
          onChange={(e) => set("resumeUrl", e.target.value)}
          placeholder="https://drive.google.com/file/d/..."
        />
        <p className="text-xs text-muted-foreground">
          Share the PDF or DOCX on Google Drive with your service account email.
        </p>
      </div>
    </div>
  );
}

export function ResumeDBPageClient() {
  const [rows, setRows] = useState<ResumeDbRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editRow, setEditRow] = useState<ResumeDbRow | null>(null);
  const [addForm, setAddForm] = useState({ ...EMPTY_FORM, date: formatToday() });
  const [editForm, setEditForm] = useState<Omit<ResumeDbRow, "rowIndex">>(EMPTY_FORM);
  const [removingRow, setRemovingRow] = useState<number | null>(null);

  const loadRows = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/resume-db");
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to load Resume DB from Google Sheet.");
      }
      const data = await res.json();
      setRows(data.resumes ?? []);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to load Resume DB.",
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRows();
  }, [loadRows]);

  const handleAdd = async () => {
    if (!addForm.resumeUrl.trim()) {
      toast.error("resume_url is required.");
      return;
    }
    setIsSaving(true);
    try {
      const res = await fetch("/api/resume-db", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(addForm),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to add row.");
      }
      toast.success("Row added to Google Sheet.");
      setIsAddOpen(false);
      setAddForm({ ...EMPTY_FORM, date: formatToday() });
      loadRows();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to add row.");
    } finally {
      setIsSaving(false);
    }
  };

  const openEdit = (row: ResumeDbRow) => {
    setEditRow(row);
    setEditForm({
      candidate: row.candidate,
      email: row.email,
      jobLink: row.jobLink,
      apply: row.apply,
      jobTitle: row.jobTitle,
      company: row.company,
      resumeUrl: row.resumeUrl,
      date: row.date,
    });
  };

  const handleUpdate = async () => {
    if (!editRow) return;
    if (!editForm.resumeUrl.trim()) {
      toast.error("resume_url is required.");
      return;
    }
    setIsSaving(true);
    try {
      const res = await fetch("/api/resume-db", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rowIndex: editRow.rowIndex, ...editForm }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to update row.");
      }
      toast.success("Row updated.");
      setEditRow(null);
      loadRows();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update row.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (rowIndex: number) => {
    if (!confirm("Delete this row from the Google Sheet?")) return;
    setRemovingRow(rowIndex);
    try {
      const res = await fetch(`/api/resume-db?id=${rowIndex}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to delete row.");
      }
      toast.success("Row deleted.");
      loadRows();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete row.");
    } finally {
      setRemovingRow(null);
    }
  };

  return (
    <JobsLayout>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold">Resume DB</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Synced with Google Sheet — resume files linked via{" "}
              <span className="font-medium">resume_url</span> (Google Drive).
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={loadRows} disabled={isLoading}>
              <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  Add entry
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Add sheet entry</DialogTitle>
                  <DialogDescription>
                    Fields match your Google Sheet: Candidate, Email, Job_link, Apply,
                    Job_title, Company, resume_url, Date.
                  </DialogDescription>
                </DialogHeader>
                <EntryForm values={addForm} onChange={setAddForm} idPrefix="add" />
                <DialogFooter>
                  <Button variant="outline" onClick={() => setIsAddOpen(false)}>
                    Cancel
                  </Button>
                  <Button onClick={handleAdd} disabled={isSaving}>
                    {isSaving ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      "Save to sheet"
                    )}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Registered entries</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading from Google Sheet...
              </div>
            ) : rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No entries yet. Add a row or populate your Google Sheet tab.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Candidate</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Job link</TableHead>
                      <TableHead>Apply</TableHead>
                      <TableHead>Job title</TableHead>
                      <TableHead>Company</TableHead>
                      <TableHead>resume_url</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead className="w-[100px]">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => (
                      <TableRow key={row.rowIndex}>
                        <TableCell className="whitespace-nowrap">
                          {row.candidate || "—"}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {row.email || "—"}
                        </TableCell>
                        <TableCell className="max-w-[160px] truncate">
                          {row.jobLink ? (
                            <a
                              href={row.jobLink}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-primary hover:underline inline-flex items-center gap-1"
                            >
                              Link
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                        <TableCell>{row.apply || "—"}</TableCell>
                        <TableCell className="max-w-[180px] truncate">
                          {row.jobTitle || "—"}
                        </TableCell>
                        <TableCell>{row.company || "—"}</TableCell>
                        <TableCell className="max-w-[140px] truncate">
                          {row.resumeUrl ? (
                            <a
                              href={row.resumeUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-primary hover:underline inline-flex items-center gap-1"
                              title={row.resumeUrl}
                            >
                              Drive
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>{row.date || "—"}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => openEdit(row)}
                              title="Edit"
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive hover:text-destructive"
                              onClick={() => handleDelete(row.rowIndex)}
                              disabled={removingRow === row.rowIndex}
                              title="Delete"
                            >
                              {removingRow === row.rowIndex ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Trash2 className="h-4 w-4" />
                              )}
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <Dialog open={editRow != null} onOpenChange={(open) => !open && setEditRow(null)}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Edit row {editRow?.rowIndex}</DialogTitle>
            </DialogHeader>
            <EntryForm values={editForm} onChange={setEditForm} idPrefix="edit" />
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditRow(null)}>
                Cancel
              </Button>
              <Button onClick={handleUpdate} disabled={isSaving}>
                {isSaving ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  "Update sheet"
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </JobsLayout>
  );
}
