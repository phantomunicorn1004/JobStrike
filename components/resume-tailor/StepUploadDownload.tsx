"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";

type StepUploadDownloadProps = {
  data: {
    generatedFile?: {
      fileName: string;
      fileType: "pdf" | "docx";
      fileSize: number;
      downloadUrl: string;
    };
  };
  updateData: (updates: Partial<any>) => void;
};

export function StepUploadDownload({
  data,
  updateData,
}: StepUploadDownloadProps) {
  const [isDownloading, setIsDownloading] = useState(false);

  const handleDownload = async () => {
    if (!data.generatedFile?.downloadUrl) {
      toast.error("No resume file available for download.");
      return;
    }

    setIsDownloading(true);
    toast.info("Preparing download...");

    try {
      const downloadUrl = data.generatedFile.downloadUrl;
      const fileName = data.generatedFile.fileName;
      const mimeType =
        data.generatedFile.fileType === "pdf"
          ? "application/pdf"
          : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

      // Handle data URL - create secure download via API
      if (downloadUrl.startsWith("data:")) {
        const secureDownloadUrl = `/api/resume-download?data=${encodeURIComponent(
          downloadUrl
        )}&fileName=${encodeURIComponent(fileName)}&mimeType=${encodeURIComponent(
          mimeType
        )}`;

        const link = document.createElement("a");
        link.href = secureDownloadUrl;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } else {
        const response = await fetch(downloadUrl);
        if (!response.ok) {
          throw new Error("Failed to fetch file");
        }
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      }

      setIsDownloading(false);
      toast.success("Resume downloaded successfully!");
    } catch (error) {
      console.error("Download error:", error);
      setIsDownloading(false);
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to download resume. Please try again."
      );
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold mb-4">Upload & Download</h2>
        <p className="text-sm text-muted-foreground mb-6">
          Download your tailored resume.
        </p>
      </div>

      <Card>
        <CardContent className="pt-6 space-y-6">
          <div className="space-y-4">
            <div>
              <Button
                onClick={handleDownload}
                disabled={isDownloading || !data.generatedFile}
                className="w-full"
                size="lg"
              >
                {isDownloading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Downloading...
                  </>
                ) : (
                  <>
                    <Download className="h-4 w-4 mr-2" />
                    Download Resume
                  </>
                )}
              </Button>
              {data.generatedFile && (
                <p className="text-xs text-muted-foreground mt-2 text-center">
                  {data.generatedFile.fileName} (
                  {(data.generatedFile.fileSize / 1024).toFixed(2)} KB)
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
