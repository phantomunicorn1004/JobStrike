"use client";

import type React from "react";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Download, ExternalLink } from "lucide-react";

import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type JobEntry = {
  id: number;
  name: string;
  title: string;
  company_name: string;
  job_link: string;
  resume_link: string;
  note: string;
  created_at: string;
};

export function JobTable() {
  const [searchTerm, setSearchTerm] = useState("");
  const [jobs, setJobs] = useState<JobEntry[]>([]);
  const [editingNoteId, setEditingNoteId] = useState<number | null>(null);
  const [noteValue, setNoteValue] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  const supabase = getSupabaseBrowserClient();

  useEffect(() => {
    fetchJobs();
  }, []);

  const fetchJobs = async () => {
    try {
      const { data, error } = await supabase.from("jobs").select("*");

      if (error) throw error;
      setJobs(data || []);
    } catch (error) {
      console.error("Error fetching jobs:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleNoteKeyDown = async (e: React.KeyboardEvent, jobId: number) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();

      try {
        const { error } = await supabase
          .from("jobs")
          .update({ note: noteValue })
          .eq("id", jobId);

        if (error) throw error;

        // Update local state
        setJobs(
          jobs.map((job) =>
            job.id === jobId ? { ...job, note: noteValue } : job
          )
        );

        setEditingNoteId(null);
        setNoteValue("");
      } catch (error) {
        console.error("Error updating note:", error);
      }
    }
  };

  const handleDownloadResume = async (resumeLink: string, name: string) => {
    try {
      const response = await fetch(resumeLink);
      if (!response.ok) {
        throw new Error("Failed to fetch resume file.");
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = name ? `${name}-resume` : "resume";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      alert("Error downloading resume.");
      console.error(error);
    }
  };

  const handleNoteClick = (jobId: number, currentNote: string) => {
    setEditingNoteId(jobId);
    setNoteValue(currentNote);
  };

  if (isLoading) {
    return (
      <Card className="w-full p-8 text-center">
        <p className="text-muted-foreground">Loading jobs...</p>
      </Card>
    );
  }

  // Always sort by ID, then filter jobs by search term (title or company name)
  const filteredJobs = jobs
    .slice()
    .sort((a, b) => a.id - b.id)
    .filter(
      (job) =>
        job.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        job.company_name.toLowerCase().includes(searchTerm.toLowerCase())
    );

  // Helper component for jobs table (used per tab). All state must be passed from above!
  function RenderJobsTable({
    jobsList,
    editingNoteId,
    noteValue,
    setNoteValue,
    handleNoteKeyDown,
    setEditingNoteId,
    handleNoteClick,
  }: {
    jobsList: JobEntry[];
    editingNoteId: number | null;
    noteValue: string;
    setNoteValue: React.Dispatch<React.SetStateAction<string>>;
    handleNoteKeyDown: (e: React.KeyboardEvent, jobId: number) => Promise<void>;
    setEditingNoteId: React.Dispatch<React.SetStateAction<number | null>>;
    handleNoteClick: (jobId: number, currentNote: string) => void;
  }) {
    return (
      <>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="w-[75px] font-semibold pl-8">
                  ID
                </TableHead>
                <TableHead className="font-semibold">Name</TableHead>
                <TableHead className="font-semibold">Title</TableHead>
                <TableHead className="font-semibold">Company Name</TableHead>
                <TableHead className="w-[120px] font-semibold">
                  Job Link
                </TableHead>
                <TableHead className="w-[140px] font-semibold">
                  Resume
                </TableHead>
                <TableHead className="font-semibold">Created Date</TableHead>
                <TableHead className="font-semibold">Note</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobsList.map((job) => (
                <TableRow key={job.id} className="hover:bg-muted/30">
                  <TableCell className="font-medium text-muted-foreground pl-8">
                    {job.id}
                  </TableCell>
                  <TableCell className="font-medium">{job.name}</TableCell>
                  <TableCell>{job.title}</TableCell>
                  <TableCell>{job.company_name}</TableCell>
                  <TableCell>
                    <a
                      href={job.job_link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-primary hover:underline"
                    >
                      <span>View Job</span>
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </TableCell>
                  <TableCell>
                    <a
                      href={job.resume_link}
                      download={`${job.name}-resume`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 btn btn-outline btn-sm"
                    >
                      <Download className="h-4 w-4" />
                      Download
                    </a>
                  </TableCell>
                  <TableCell>
                    {job.created_at
                      ? new Date(job.created_at).toLocaleString()
                      : ""}
                  </TableCell>

                  <TableCell className="max-w-[300px]">
                    {editingNoteId === job.id ? (
                      <Textarea
                        value={noteValue}
                        onChange={(e) => setNoteValue(e.target.value)}
                        onKeyDown={(e) => handleNoteKeyDown(e, job.id)}
                        onBlur={() => setEditingNoteId(null)}
                        autoFocus
                        className="min-h-[60px] text-sm"
                        placeholder="Enter note and press Enter to save..."
                      />
                    ) : (
                      <div
                        onClick={() => handleNoteClick(job.id, job.note)}
                        className="text-muted-foreground text-sm cursor-pointer hover:bg-muted/50 p-2 rounded min-h-[40px]"
                      >
                        {job.note || "Click to add note..."}
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </>
    );
  }

  return (
    <Card className="w-full">
      <div className="p-4 flex items-center justify-between">
        <div className="relative w-64">
          <span className="absolute inset-y-0 left-0 flex items-center pl-2 text-gray-400 pointer-events-none">
            <svg
              width="18"
              height="18"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="lucide lucide-search"
              viewBox="0 0 24 24"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="M21 21l-4.3-4.3" />
            </svg>
          </span>
          <input
            type="text"
            placeholder="Search jobs..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-8 pr-2 py-1 w-full border rounded outline-none focus:ring-2 focus:ring-primary text-sm"
          />
        </div>
      </div>
      <RenderJobsTable
        jobsList={filteredJobs}
        // currentPage={currentPage}
        // setCurrentPage={setCurrentPage}
        editingNoteId={editingNoteId}
        noteValue={noteValue}
        setNoteValue={setNoteValue}
        handleNoteKeyDown={handleNoteKeyDown}
        setEditingNoteId={setEditingNoteId}
        handleNoteClick={handleNoteClick}
      />
    </Card>
  );
}
