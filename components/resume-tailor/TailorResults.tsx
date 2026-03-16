"use client";

import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Download, AlertCircle, Copy } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type TailorResultsProps = {
  data: {
    tailoredResume: string;
    matchedKeywords: string[];
    missingKeywords: string[];
    recommendations: string[];
    generatedFiles?: {
      docx: {
        fileName: string;
        fileType: string;
        fileSize: number;
        downloadUrl: string;
        mimeType: string;
      };
      pdf: {
        fileName: string;
        fileType: string;
        fileSize: number;
        downloadUrl: string;
        mimeType: string;
      };
    };
  };
  onDownload: (format: "docx" | "pdf") => void;
  onGenerateFile: () => void;
  updateData: (updates: any) => void;
};

export function TailorResults({
  data,
  onDownload,
  onGenerateFile,
  updateData,
}: TailorResultsProps) {
  const [showFullResume, setShowFullResume] = useState(false);

  const handleCopyResume = () => {
    navigator.clipboard.writeText(data.tailoredResume);
    toast.success("Resume copied to clipboard");
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Tailored Resume</CardTitle>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={handleCopyResume}>
                <Copy className="h-4 w-4 mr-2" />
                Copy
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowFullResume(!showFullResume)}
              >
                {showFullResume ? "Show Summary" : "Show Full"}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Textarea
            value={data.tailoredResume}
            readOnly
            className={cn(
              "font-mono text-sm",
              !showFullResume && "max-h-64 overflow-y-auto"
            )}
            rows={showFullResume ? 30 : 10}
          />
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Matched Keywords</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {data.matchedKeywords.length > 0 ? (
                data.matchedKeywords.map((keyword, idx) => (
                  <Badge key={idx} variant="default" className="bg-green-500">
                    {keyword}
                  </Badge>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">No keywords matched</p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Missing Keywords</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {data.missingKeywords.length > 0 ? (
                data.missingKeywords.map((keyword, idx) => (
                  <Badge key={idx} variant="outline" className="border-yellow-500 text-yellow-700 dark:text-yellow-400">
                    {keyword}
                  </Badge>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">All keywords matched!</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {data.recommendations.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Recommendations</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {data.recommendations.map((rec, idx) => (
                <li key={idx} className="flex items-start gap-2 text-sm">
                  <AlertCircle className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                  <span>{rec}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Separator />

      <Card>
        <CardHeader>
          <CardTitle>Download & Share</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <Button
              onClick={() => onDownload("pdf")}
              disabled={!data.generatedFiles}
              className="flex-1"
              size="lg"
            >
              <Download className="h-4 w-4 mr-2" />
              Download PDF
            </Button>
            <Button
              variant="outline"
              onClick={() => onDownload("docx")}
              disabled={!data.generatedFiles}
              className="flex-1"
              size="lg"
            >
              <Download className="h-4 w-4 mr-2" />
              Download DOCX
            </Button>
          </div>

          {data.generatedFiles && (
            <div className="p-4 bg-muted rounded-lg space-y-2">
              <p className="text-sm text-muted-foreground">
                <strong>Files Generated:</strong>
              </p>
              <div className="text-sm text-muted-foreground">
                <div>• {data.generatedFiles.docx.fileName} ({(data.generatedFiles.docx.fileSize / 1024).toFixed(1)} KB)</div>
                <div>• {data.generatedFiles.pdf.fileName} ({(data.generatedFiles.pdf.fileSize / 1024).toFixed(1)} KB)</div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
