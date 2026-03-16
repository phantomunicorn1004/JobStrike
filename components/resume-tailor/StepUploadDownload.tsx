"use client";

import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import {
  Download,
  Upload,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
} from "lucide-react";
import { toast } from "sonner";
import {
  getGoogleAuthUrl,
  checkGoogleDriveAuth,
  uploadToGoogleDrive,
} from "@/lib/googleDrive";
import { useSearchParams } from "next/navigation";

type StepUploadDownloadProps = {
  data: {
    generatedFile?: {
      fileName: string;
      fileType: "pdf" | "docx";
      fileSize: number;
      downloadUrl: string;
    };
    uploadedToDrive: boolean;
    googleDriveMetadata?: {
      fileId: string;
      fileUrl: string;
      uploadedAt: string;
    };
    jobId?: string | number;
  };
  updateData: (updates: Partial<any>) => void;
};

export function StepUploadDownload({
  data,
  updateData,
}: StepUploadDownloadProps) {
  const searchParams = useSearchParams();
  const [isDownloading, setIsDownloading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadEnabled, setUploadEnabled] = useState(false);
  const [isCheckingAuth, setIsCheckingAuth] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  // Check authentication status on mount and when upload is enabled
  useEffect(() => {
    if (uploadEnabled) {
      checkAuthStatus();
    }
  }, [uploadEnabled]);

  // Handle OAuth callback
  useEffect(() => {
    const authSuccess = searchParams?.get("drive_auth_success");
    const authError = searchParams?.get("drive_auth_error");

    if (authSuccess === "true") {
      toast.success("Successfully authenticated with Google Drive!");
      setIsAuthenticated(true);
      // Clean up URL
      window.history.replaceState({}, "", window.location.pathname);
    } else if (authError) {
      toast.error(
        `Google Drive authentication failed: ${decodeURIComponent(authError)}`
      );
      setIsAuthenticated(false);
      // Clean up URL
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [searchParams]);

  const checkAuthStatus = async () => {
    setIsCheckingAuth(true);
    try {
      const authenticated = await checkGoogleDriveAuth();
      setIsAuthenticated(authenticated);
    } catch (error) {
      console.error("Error checking auth status:", error);
      setIsAuthenticated(false);
    } finally {
      setIsCheckingAuth(false);
    }
  };

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
        const matches = downloadUrl.match(/^data:([^;]+);base64,(.+)$/);
        if (!matches) {
          throw new Error("Invalid file data format");
        }

        // Use secure download endpoint
        const secureDownloadUrl = `/api/resume-download?data=${encodeURIComponent(
          downloadUrl
        )}&fileName=${encodeURIComponent(fileName)}&mimeType=${encodeURIComponent(
          mimeType
        )}`;

        // Trigger download
        const link = document.createElement("a");
        link.href = secureDownloadUrl;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } else {
        // Regular URL - fetch and download
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

  const handleAuthorizeGoogleDrive = async () => {
    try {
      const result = await getGoogleAuthUrl();
      if (result.success && result.authUrl) {
        // Redirect to Google OAuth
        window.location.href = result.authUrl;
      } else {
        toast.error(result.error || "Failed to get authorization URL");
      }
    } catch (error) {
      console.error("Authorization error:", error);
      toast.error("Failed to initiate Google Drive authorization");
    }
  };

  const handleUpload = async () => {
    if (!data.generatedFile) {
      toast.error("No resume file available for upload.");
      return;
    }

    if (!data.jobId) {
      toast.error("Job ID is required for Google Drive upload.");
      return;
    }

    // Check authentication first
    if (!isAuthenticated) {
      toast.info("Please authorize Google Drive access first.");
      await handleAuthorizeGoogleDrive();
      return;
    }

    setIsUploading(true);
    toast.info("Uploading to Google Drive...");

    try {
      const downloadUrl = data.generatedFile.downloadUrl;
      let fileBuffer: Buffer | ArrayBuffer | Uint8Array;
      let mimeType: string;

      // Extract file data
      if (downloadUrl.startsWith("data:")) {
        const matches = downloadUrl.match(/^data:([^;]+);base64,(.+)$/);
        if (!matches) {
          throw new Error("Invalid file data format");
        }
        mimeType = matches[1];
        const base64Data = matches[2];
        const byteCharacters = atob(base64Data);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        fileBuffer = new Uint8Array(byteNumbers);
      } else {
        const response = await fetch(downloadUrl);
        if (!response.ok) {
          throw new Error("Failed to fetch file for upload");
        }
        fileBuffer = await response.arrayBuffer();
        mimeType =
          response.headers.get("content-type") ||
          (data.generatedFile.fileType === "pdf"
            ? "application/pdf"
            : "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      }

      // Upload to Google Drive
      const result = await uploadToGoogleDrive(
        fileBuffer,
        data.generatedFile.fileName,
        mimeType,
        data.jobId
      );

      if (result.success && result.fileId && result.fileUrl) {
        const metadata = {
          fileId: result.fileId,
          fileUrl: result.fileUrl,
          uploadedAt: result.uploadedAt || new Date().toISOString(),
        };

        updateData({
          uploadedToDrive: true,
          googleDriveMetadata: metadata,
        });

        setIsUploading(false);
        toast.success("Successfully uploaded to Google Drive!");
      } else {
        throw new Error(result.error || "Upload failed");
      }
    } catch (error) {
      console.error("Upload error:", error);
      setIsUploading(false);
      
      // Fail gracefully - don't block the workflow
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Failed to upload to Google Drive. Please try again.";
      
      // Check if it's an auth error
      if (errorMessage.includes("authenticated") || errorMessage.includes("authorize")) {
        toast.error(errorMessage);
        setIsAuthenticated(false);
      } else {
        toast.error(errorMessage);
      }
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold mb-4">Upload & Download</h2>
        <p className="text-sm text-muted-foreground mb-6">
          Download your resume or optionally upload it to Google Drive.
        </p>
      </div>

      <Card>
        <CardContent className="pt-6 space-y-6">
          <div className="space-y-4">
            {/* Download Section */}
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

            {/* Google Drive Upload Section */}
            <div className="border-t pt-4">
              <div className="flex items-center justify-between mb-4">
                <div className="space-y-0.5">
                  <Label htmlFor="upload-toggle">Upload to Google Drive</Label>
                  <p className="text-sm text-muted-foreground">
                    Optional: Save your resume to Google Drive
                  </p>
                </div>
                <Switch
                  id="upload-toggle"
                  checked={uploadEnabled}
                  onCheckedChange={(checked) => {
                    setUploadEnabled(checked);
                    // Reset upload state when toggling off
                    if (!checked) {
                      setIsAuthenticated(false);
                    }
                  }}
                  disabled={!data.generatedFile}
                />
              </div>

              {uploadEnabled && (
                <div className="space-y-3">
                  {isCheckingAuth ? (
                    <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground py-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Checking authentication...
                    </div>
                  ) : !isAuthenticated ? (
                    <Button
                      onClick={handleAuthorizeGoogleDrive}
                      variant="outline"
                      className="w-full"
                    >
                      <ExternalLink className="h-4 w-4 mr-2" />
                      Authorize Google Drive Access
                    </Button>
                  ) : (
                    <>
                      <Button
                        onClick={handleUpload}
                        disabled={
                          isUploading ||
                          data.uploadedToDrive ||
                          !data.generatedFile ||
                          !data.jobId
                        }
                        variant="outline"
                        className="w-full"
                      >
                        {isUploading ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            Uploading...
                          </>
                        ) : data.uploadedToDrive ? (
                          <>
                            <CheckCircle2 className="h-4 w-4 mr-2 text-green-500" />
                            Uploaded to Google Drive
                          </>
                        ) : (
                          <>
                            <Upload className="h-4 w-4 mr-2" />
                            Upload to Google Drive
                          </>
                        )}
                      </Button>

                      {data.uploadedToDrive && data.googleDriveMetadata && (
                        <div className="space-y-2 p-3 bg-green-50 dark:bg-green-950 rounded-lg border border-green-200 dark:border-green-800">
                          <div className="flex items-center justify-center gap-2 text-sm text-green-600 dark:text-green-400">
                            <CheckCircle2 className="h-4 w-4" />
                            <p className="font-medium">Successfully uploaded to Google Drive!</p>
                          </div>
                          <div className="flex items-center justify-center">
                            <a
                              href={data.googleDriveMetadata.fileUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-sm text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
                            >
                              View in Google Drive
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          </div>
                          <p className="text-xs text-muted-foreground text-center">
                            Uploaded at: {new Date(data.googleDriveMetadata.uploadedAt).toLocaleString()}
                          </p>
                        </div>
                      )}
                    </>
                  )}

                  {!data.jobId && (
                    <div className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950 p-2 rounded border border-amber-200 dark:border-amber-800">
                      <AlertCircle className="h-4 w-4" />
                      <p>Job ID is required for Google Drive upload.</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="bg-muted/50 p-4 rounded-lg">
        <p className="text-sm text-muted-foreground">
          <strong>Note:</strong> Download is always available. Upload to Google
          Drive is optional and requires authorization.
        </p>
      </div>
    </div>
  );
}
