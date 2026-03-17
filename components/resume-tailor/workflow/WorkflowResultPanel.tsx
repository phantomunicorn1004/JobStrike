"use client";

import React from "react";
import type { WorkflowExecutionResult } from "./contracts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { X, Download, FileText } from "lucide-react";

interface WorkflowResultPanelProps {
  result: WorkflowExecutionResult;
  onClose: () => void;
}

export function WorkflowResultPanel({ result, onClose }: WorkflowResultPanelProps) {
  const handleDownload = (dataUrl: string | undefined, fileName: string, format: string) => {
    if (!dataUrl) return;
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = fileName || `resume.${format}`;
    a.click();
  };

  const pdf = result.pdf;
  const ats = result.atsAnalysis;

  return (
    <Card className="border-primary/30">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-lg">Workflow result</CardTitle>
        <Button variant="ghost" size="icon" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {pdf?.pdfDataUrl && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              onClick={() => handleDownload(pdf.pdfDataUrl, pdf.pdfFileName ?? "resume.pdf", "pdf")}
            >
              <Download className="h-4 w-4 mr-2" />
              Download PDF
            </Button>
            {pdf.docxDataUrl && (
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  handleDownload(pdf.docxDataUrl, pdf.docxFileName ?? "resume.docx", "docx")
                }
              >
                <FileText className="h-4 w-4 mr-2" />
                Download DOCX
              </Button>
            )}
          </div>
        )}

        {ats && (
          <div>
            <h4 className="text-sm font-medium mb-2">ATS analysis</h4>
            <div className="flex items-center gap-2 mb-2">
              <Badge variant={ats.score >= 70 ? "default" : ats.score >= 50 ? "secondary" : "destructive"}>
                Score: {ats.score}
              </Badge>
            </div>
            {ats.matchedKeywords?.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Matched: {ats.matchedKeywords.slice(0, 10).join(", ")}
                {ats.matchedKeywords.length > 10 ? "…" : ""}
              </p>
            )}
            {ats.missingKeywords?.length > 0 && (
              <p className="text-xs text-muted-foreground mt-1">
                Missing: {ats.missingKeywords.slice(0, 8).join(", ")}
                {ats.missingKeywords.length > 8 ? "…" : ""}
              </p>
            )}
            {ats.improvementNotes && ats.improvementNotes.length > 0 && (
              <ul className="text-xs text-muted-foreground mt-2 list-disc list-inside">
                {ats.improvementNotes.slice(0, 5).map((note, i) => (
                  <li key={i}>{note}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {result.validationWarnings && result.validationWarnings.length > 0 && (
          <div>
            <h4 className="text-sm font-medium text-amber-600 dark:text-amber-400">Warnings</h4>
            <ul className="text-xs list-disc list-inside">
              {result.validationWarnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
        )}

        {result.updatedResume && (
          <p className="text-xs text-muted-foreground">
            Updated resume JSON is available in context for downstream use.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
