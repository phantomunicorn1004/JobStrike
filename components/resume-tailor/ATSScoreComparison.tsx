"use client";

import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

type ATSScoreComparisonProps = {
  originalScore: number | null;
  improvedScore: number | null;
};

export function ATSScoreComparison({ originalScore, improvedScore }: ATSScoreComparisonProps) {
  if (originalScore === null || improvedScore === null) {
    return null;
  }

  const delta = improvedScore - originalScore;
  const improvementPercent = originalScore > 0 ? ((delta / originalScore) * 100).toFixed(1) : "0";

  const getScoreColor = (score: number) => {
    if (score >= 80) return "text-green-600 dark:text-green-400";
    if (score >= 60) return "text-yellow-600 dark:text-yellow-400";
    return "text-red-600 dark:text-red-400";
  };

  const getScoreLabel = (score: number) => {
    if (score >= 80) return "Excellent";
    if (score >= 60) return "Good";
    if (score >= 40) return "Fair";
    return "Needs Work";
  };

  const getScoreBgColor = (score: number) => {
    if (score >= 80) return "bg-green-500";
    if (score >= 60) return "bg-yellow-500";
    return "bg-red-500";
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>ATS Score Improvement</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="text-center">
            <p className="text-sm text-muted-foreground mb-2">Original Score</p>
            <div className="relative inline-block mb-2">
              <div className="text-4xl font-bold" style={{ color: getScoreColor(originalScore) }}>
                {originalScore}
              </div>
              <span className="text-2xl text-muted-foreground">%</span>
            </div>
            <Badge variant="outline" className={cn("mt-2", getScoreColor(originalScore))}>
              {getScoreLabel(originalScore)}
            </Badge>
            <div className="mt-4">
              <Progress value={originalScore} className="h-2" />
            </div>
          </div>

          <div className="text-center flex flex-col items-center justify-center">
            <div className="mb-4">
              {delta > 0 ? (
                <TrendingUp className="h-8 w-8 text-green-600 dark:text-green-400" />
              ) : delta < 0 ? (
                <TrendingDown className="h-8 w-8 text-red-600 dark:text-red-400" />
              ) : (
                <Minus className="h-8 w-8 text-muted-foreground" />
              )}
            </div>
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Improvement</p>
              <div
                className={cn(
                  "text-2xl font-bold",
                  delta > 0
                    ? "text-green-600 dark:text-green-400"
                    : delta < 0
                      ? "text-red-600 dark:text-red-400"
                      : "text-muted-foreground"
                )}
              >
                {delta > 0 ? "+" : ""}
                {delta}%
              </div>
              <p className="text-xs text-muted-foreground">
                {improvementPercent}% better
              </p>
            </div>
          </div>

          <div className="text-center">
            <p className="text-sm text-muted-foreground mb-2">Improved Score</p>
            <div className="relative inline-block mb-2">
              <div className="text-4xl font-bold" style={{ color: getScoreColor(improvedScore) }}>
                {improvedScore}
              </div>
              <span className="text-2xl text-muted-foreground">%</span>
            </div>
            <Badge variant="outline" className={cn("mt-2", getScoreColor(improvedScore))}>
              {getScoreLabel(improvedScore)}
            </Badge>
            <div className="mt-4">
              <Progress value={improvedScore} className="h-2" />
            </div>
          </div>
        </div>

        {delta > 0 && (
          <div className="mt-6 p-4 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800">
            <p className="text-sm text-green-800 dark:text-green-200">
              <strong>Great improvement!</strong> Your resume is now {delta}% more ATS-compatible.
              This significantly increases your chances of passing automated screening.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
