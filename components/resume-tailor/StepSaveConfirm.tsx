"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";

type StepSaveConfirmProps = {
  data: {
    jobTitle: string;
    companyName: string;
    resumeFileName: string;
    atsScore: number | null;
    savedToJob: boolean;
  };
  updateData: (updates: Partial<any>) => void;
};

export function StepSaveConfirm({ data, updateData }: StepSaveConfirmProps) {
  const [isSaving, setIsSaving] = useState(false);

  const handleSaveToJob = async () => {
    setIsSaving(true);
    toast.info("Saving to Job table...");
    
    // Simulate save delay (800ms)
    await new Promise((resolve) => setTimeout(resolve, 800));
    
    updateData({ savedToJob: true });
    setIsSaving(false);
    toast.success("Resume saved to Job table successfully!");
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold mb-4">Save Confirmation</h2>
        <p className="text-sm text-muted-foreground mb-6">
          Review your information and save to the Job table.
        </p>
      </div>

      <Card className="border-green-500">
        <CardHeader>
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-green-500" />
            <CardTitle>Success Summary</CardTitle>
          </div>
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
              <p className="text-sm text-muted-foreground mb-1">ATS Score</p>
              {data.atsScore !== null ? (
                <Badge
                  variant={
                    data.atsScore >= 80
                      ? "default"
                      : data.atsScore >= 60
                      ? "secondary"
                      : "destructive"
                  }
                >
                  {data.atsScore}%
                </Badge>
              ) : (
                <span className="text-muted-foreground">N/A</span>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-4">
        <Button
          onClick={handleSaveToJob}
          disabled={data.savedToJob || isSaving}
          className="w-full"
          size="lg"
        >
          {isSaving ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Saving...
            </>
          ) : data.savedToJob ? (
            <>
              <CheckCircle2 className="h-4 w-4 mr-2" />
              Saved to Job
            </>
          ) : (
            <>
              <FileText className="h-4 w-4 mr-2" />
              Save to Job
            </>
          )}
        </Button>

        {data.savedToJob && (
          <div className="bg-green-50 dark:bg-green-950 p-4 rounded-lg border border-green-200 dark:border-green-800">
            <p className="text-sm text-green-800 dark:text-green-200 text-center">
              ✓ Resume successfully saved to Job table!
            </p>
          </div>
        )}
      </div>

      <div className="bg-muted/50 p-4 rounded-lg">
        <p className="text-sm text-muted-foreground text-center">
          You can now finish or go back to make changes.
        </p>
      </div>
    </div>
  );
}
