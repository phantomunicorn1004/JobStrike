"use client";

import type React from "react";
import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogTitle,
  DialogHeader,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Download } from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

// Status icons
const StatusIcon = ({ result }: { result?: string }) => {
  if (result === "success")
    return (
      <span title="Success" style={{ color: "green" }}>
        ✔️
      </span>
    );
  if (result === "fail")
    return (
      <span title="Failed" style={{ color: "red" }}>
        ❌
      </span>
    );
  return (
    <span title="Ongoing" style={{ color: "#EAB308" }}>
      ⏳
    </span>
  );
};

export type TechnicalJobEntry = {
  id: number;
  name: string;
  company_name: string;
  title: string;
  job_description?: string;
  resume_link: string;
  recruiter_name?: string;
  recruiter_contact?: string;
  first_round_date?: string | null;
  first_round_result?: string | null;
  second_round_date?: string | null;
  second_round_result?: string | null;
  third_round_date?: string | null;
  third_round_result?: string | null;
  status?: string | null; // Add status for job
  created_at?: string;

  // index signature for round fields
};

export function TechnicalJobTable() {
  const [jobs, setJobs] = useState<TechnicalJobEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const supabase = getSupabaseBrowserClient();

  useEffect(() => {
    fetchJobs();
  }, []);

  const fetchJobs = async () => {
    try {
      const { data, error } = await supabase.from("technical_jobs").select("*");
      if (error) throw error;
      setJobs(data || []);
    } catch (e) {
      console.error("Error fetching technical jobs:", e);
    } finally {
      setIsLoading(false);
    }
  };

  const updateRound = async (
    id: number,
    round: 1 | 2 | 3,
    field: "date" | "result",
    value: string
  ) => {
    const column = `${["first", "second", "third"][round - 1]}_round_${field}`;
    try {
      const { error } = await supabase
        .from("technical_jobs")
        .update({ [column]: value })
        .eq("id", id);
      if (error) throw error;
      setJobs((jobs) =>
        jobs.map((j) => (j.id === id ? { ...j, [column]: value } : j))
      );
    } catch (e) {
      console.error("Update failed", e);
    }
  };

  const [showModal, setShowModal] = useState(false);
  const [newJob, setNewJob] = useState<Partial<TechnicalJobEntry>>({});
  const [isCreating, setIsCreating] = useState(false);

  if (isLoading) {
    return (
      <Card className="w-full p-8 text-center">
        <p className="text-muted-foreground">Loading technical jobs...</p>
      </Card>
    );
  }

  const handleInput = (key: keyof TechnicalJobEntry, value: string) => {
    setNewJob((prev) => ({ ...prev, [key]: value }));
  };

  const handleCreate = async () => {
    setIsCreating(true);
    try {
      // Only required/used fields for new creation:
      const insertData = {
        name: newJob.name || "",
        company_name: newJob.company_name || "",
        title: newJob.title || "",
        job_description: newJob.job_description || "",
        resume_link: newJob.resume_link || "",
        recruiter_name: newJob.recruiter_name || "",
        recruiter_contact: newJob.recruiter_contact || "",
        first_round_date: newJob.first_round_date || null,
        first_round_result: newJob.first_round_result || "",
        second_round_date: newJob.second_round_date || null,
        second_round_result: newJob.second_round_result || "",
        third_round_date: newJob.third_round_date || null,
        third_round_result: newJob.third_round_result || "",
        status: newJob.status || "ongoing",
      };

      if (
        !insertData.name.trim() ||
        !insertData.company_name.trim() ||
        !insertData.title.trim() ||
        !insertData.resume_link.trim()
      ) {
        alert("Please fill out all required fields.");
        setIsCreating(false);
        return;
      }
      const { data, error } = await supabase
        .from("technical_jobs")
        .insert([insertData])
        .select();
      if (error) throw error;
      setJobs((j) => (data ? [...j, ...data] : j));
      setShowModal(false);
      setNewJob({});
    } catch (e: any) {
      alert(
        e?.message || "Failed to create job. Please check required fields."
      );
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <Card className="w-full">
      <div className="flex items-center justify-end px-4 pt-4">
        <Dialog open={showModal} onOpenChange={setShowModal}>
          <DialogTrigger asChild>
            <Button onClick={() => setShowModal(true)}>Add +</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add New Technical Job</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4">
              <Input
                placeholder="Name*"
                value={newJob.name || ""}
                onChange={(e) => handleInput("name", e.target.value)}
              />
              <Input
                placeholder="Company Name*"
                value={newJob.company_name || ""}
                onChange={(e) => handleInput("company_name", e.target.value)}
              />
              <Input
                placeholder="Title*"
                value={newJob.title || ""}
                onChange={(e) => handleInput("title", e.target.value)}
              />
              {/* <Textarea
                placeholder="Job Description"
                value={newJob.job_description || ""}
                onChange={(e) => handleInput("job_description", e.target.value)}
              /> */}
              <Input
                placeholder="Resume Link*"
                value={newJob.resume_link || ""}
                onChange={(e) => handleInput("resume_link", e.target.value)}
              />
              <Input
                placeholder="Recruiter Name"
                value={newJob.recruiter_name || ""}
                onChange={(e) => handleInput("recruiter_name", e.target.value)}
              />
              <Input
                placeholder="Recruiter Contact"
                value={newJob.recruiter_contact || ""}
                onChange={(e) =>
                  handleInput("recruiter_contact", e.target.value)
                }
              />
              <div className="flex gap-2 items-center">
                <span className="text-sm font-medium">1st Round</span>
                <Input
                  type="date"
                  value={newJob.first_round_date || ""}
                  onChange={(e) =>
                    handleInput("first_round_date", e.target.value)
                  }
                  style={{ maxWidth: 120 }}
                />
              </div>
              <div className="flex gap-2 items-center">
                <span className="text-sm font-medium">2nd Round</span>
                <Input
                  type="date"
                  value={newJob.second_round_date || ""}
                  onChange={(e) =>
                    handleInput("second_round_date", e.target.value)
                  }
                  style={{ maxWidth: 120 }}
                />
              </div>
              <div className="flex gap-2 items-center">
                <span className="text-sm font-medium">3rd Round</span>
                <Input
                  type="date"
                  value={newJob.third_round_date || ""}
                  onChange={(e) =>
                    handleInput("third_round_date", e.target.value)
                  }
                  style={{ maxWidth: 120 }}
                />
              </div>
              <div className="flex gap-2 items-center">
                <span className="text-sm font-medium">Result</span>
                <select
                  className="border p-1 rounded"
                  value={newJob.status || "ongoing"}
                  onChange={(e) => handleInput("status", e.target.value)}
                >
                  <option value="success">Success</option>
                  <option value="fail">Fail</option>
                  <option value="ongoing">Ongoing</option>
                </select>
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                onClick={handleCreate}
                disabled={isCreating}
              >
                Create
              </Button>
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  Cancel
                </Button>
              </DialogClose>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ID</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Company Name</TableHead>
              <TableHead>Title</TableHead>
              {/* <TableHead>Job Description</TableHead> */}
              <TableHead>Resume</TableHead>
              <TableHead>Recruiter Name</TableHead>
              <TableHead>Recruiter Contact</TableHead>
              <TableHead>First Round</TableHead>
              <TableHead>Second Round</TableHead>
              <TableHead>Third Round</TableHead>
              <TableHead>Result</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {jobs.map((job) => (
              <TableRow key={job.id}>
                <TableCell className="text-center align-middle">
                  {job.id}
                </TableCell>
                <TableCell className="text-center align-middle">
                  {job.name}
                </TableCell>
                <TableCell className="text-center align-middle">
                  {job.company_name}
                </TableCell>
                <TableCell className="text-center align-middle">
                  {job.title}
                </TableCell>
                {/* <TableCell className="text-center align-middle max-w-[300px] whitespace-pre-wrap">
                  {job.job_description}
                </TableCell> */}
                <TableCell>
                  <a
                    href={job.resume_link}
                    download
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-primary"
                  >
                    <Download className="h-4 w-4" /> Download
                  </a>
                </TableCell>
                <TableCell className="text-center align-middle">
                  {job.recruiter_name}
                </TableCell>
                <TableCell className="text-center align-middle">
                  {job.recruiter_contact}
                </TableCell>
                {[1, 2, 3].map((round) => (
                  <TableCell key={round}>
                    <input
                      type="date"
                      value={
                        job[
                          `${
                            ["first", "second", "third"][round - 1]
                          }_round_date`
                        ] || ""
                      }
                      onChange={(e) =>
                        updateRound(
                          job.id,
                          round as 1 | 2 | 3,
                          "date",
                          e.target.value
                        )
                      }
                      style={{ width: "110px" }}
                    />
                  </TableCell>
                ))}
                <TableCell />
                <TableCell className="text-center align-middle">
                  <StatusIcon result={job.status || undefined} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}
