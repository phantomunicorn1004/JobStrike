"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, CheckCircle2, XCircle, AlertTriangle, Info } from "lucide-react";
import { toast } from "sonner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

type StepATSCheckProps = {
  data: {
    jobTitle: string;
    jobDescription: string;
    tailoredResume: string;
    atsScore: number | null;
    matchedKeywords: string[];
    missingKeywords: string[];
    weakKeywords?: string[];
    recommendations?: string[];
  };
  updateData: (updates: Partial<any>) => void;
};

export function StepATSCheck({ data, updateData }: StepATSCheckProps) {
  const [isChecking, setIsChecking] = useState(false);

  const handleATSCheck = async () => {
    if (!data.jobTitle || !data.jobDescription || !data.tailoredResume) {
      toast.error(
        "Missing required information. Please complete previous steps."
      );
      return;
    }

    setIsChecking(true);
    toast.info("Analyzing ATS compatibility...");

    try {
      const response = await fetch("/api/ats-check", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          jobTitle: data.jobTitle,
          jobDescription: data.jobDescription,
          tailoredResumeText: data.tailoredResume,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to check ATS compatibility");
      }

      const result = await response.json();

      updateData({
        atsScore: result.ats_score,
        matchedKeywords: result.matched_keywords || [],
        missingKeywords: result.missing_keywords || [],
        weakKeywords: result.weak_keywords || [],
        recommendations: result.recommendations || [],
      });

      const score = result.ats_score;
      if (score >= 80) {
        toast.success(`Excellent ATS score: ${score}%`);
      } else if (score >= 60) {
        toast.info(`Good ATS score: ${score}%`);
      } else {
        toast.warning(`ATS score needs improvement: ${score}%`);
      }
    } catch (error) {
      console.error("Error checking ATS:", error);
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to check ATS compatibility. Please try again."
      );
    } finally {
      setIsChecking(false);
    }
  };

  const getScoreColor = (score: number | null) => {
    if (!score) return "bg-muted";
    if (score >= 80) return "bg-green-500";
    if (score >= 60) return "bg-yellow-500";
    return "bg-red-500";
  };

  const getScoreLabel = (score: number | null) => {
    if (!score) return "Not Checked";
    if (score >= 80) return "Excellent";
    if (score >= 60) return "Good";
    return "Needs Improvement";
  };

  // Auto-run ATS check if not done yet and we have required data
  React.useEffect(() => {
    if (
      data.atsScore === null &&
      !isChecking &&
      data.jobTitle &&
      data.jobDescription &&
      data.tailoredResume
    ) {
      handleATSCheck();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold mb-4">ATS Check</h2>
        <p className="text-sm text-muted-foreground mb-6">
          Review your resume's ATS compatibility score and keyword matches.
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CardTitle>ATS Score</CardTitle>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="h-4 w-4 text-muted-foreground cursor-help" />
                </TooltipTrigger>
                <TooltipContent>
                  <p className="max-w-xs">
                    ATS score reflects keyword alignment only. It measures how well your resume matches the job description's key terms.
                  </p>
                </TooltipContent>
              </Tooltip>
            </div>
            <Button
              onClick={handleATSCheck}
              disabled={isChecking}
              variant="outline"
              size="sm"
            >
              {isChecking ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Checking...
                </>
              ) : (
                "Re-check ATS"
              )}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {isChecking ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : data.atsScore !== null ? (
            <>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-2xl font-bold">{data.atsScore}%</span>
                  <Badge
                    variant={
                      data.atsScore >= 80
                        ? "default"
                        : data.atsScore >= 60
                        ? "secondary"
                        : "destructive"
                    }
                  >
                    {getScoreLabel(data.atsScore)}
                  </Badge>
                </div>
                <Progress value={data.atsScore} className="h-3" />
              </div>
            </>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              Click "Re-check ATS" to analyze your resume
            </div>
          )}
        </CardContent>
      </Card>

      {data.atsScore !== null && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                Matched Keywords
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data.matchedKeywords.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {data.matchedKeywords.map((keyword, idx) => (
                    <Badge key={idx} variant="default">
                      {keyword}
                    </Badge>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No keywords matched
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <XCircle className="h-4 w-4 text-red-500" />
                Missing Keywords
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data.missingKeywords.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {data.missingKeywords.map((keyword, idx) => (
                    <Badge key={idx} variant="outline">
                      {keyword}
                    </Badge>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  All keywords matched!
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {data.weakKeywords && data.weakKeywords.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-yellow-500" />
              Weak Keywords
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-2">
              These keywords appear but could be emphasized more:
            </p>
            <div className="flex flex-wrap gap-2">
              {data.weakKeywords.map((keyword, idx) => (
                <Badge key={idx} variant="secondary">
                  {keyword}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {data.recommendations && data.recommendations.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recommendations</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {data.recommendations.map((rec, idx) => (
                <li key={idx} className="text-sm flex items-start gap-2">
                  <span className="text-primary mt-1">•</span>
                  <span>{rec}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <div className="bg-muted/50 p-4 rounded-lg">
        <p className="text-sm text-muted-foreground">
          <strong>Note:</strong> You can go back to Step 3 to edit your resume
          and improve your ATS score. Resume remains fully editable.
        </p>
      </div>
    </div>
  );
}
