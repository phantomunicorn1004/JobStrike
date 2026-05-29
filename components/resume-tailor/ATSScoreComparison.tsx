"use client";

import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  scoreTextClass,
  successPanelClass,
  successTextStrongClass,
} from "@/lib/ui/semanticColors";

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

  const getScoreColor = scoreTextClass;

  const getScoreLabel = (score: number) => {
    if (score >= 80) return "Excellent";
    if (score >= 60) return "Good";
    if (score >= 40) return "Fair";
    return "Needs Work";
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
              <div className={cn("text-4xl font-bold", getScoreColor(originalScore))}>
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
                <TrendingUp className="h-8 w-8 text-emerald-600 dark:text-emerald-400" />
              ) : delta < 0 ? (
                <TrendingDown className="h-8 w-8 text-destructive" />
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
                    ? "text-emerald-600 dark:text-emerald-400"
                    : delta < 0
                      ? "text-destructive"
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
              <div className={cn("text-4xl font-bold", getScoreColor(improvedScore))}>
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
          <div className={cn("mt-6 rounded-lg p-4", successPanelClass)}>
            <p className={cn("text-sm", successTextStrongClass)}>
              <strong>Great improvement!</strong> Your resume is now {delta}% more ATS-compatible.
              This significantly increases your chances of passing automated screening.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
