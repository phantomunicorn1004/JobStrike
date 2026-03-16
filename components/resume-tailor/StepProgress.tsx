"use client";

import React from "react";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { Check } from "lucide-react";

type StepProgressProps = {
  currentStep: number;
  totalSteps: number;
};

export function StepProgress({ currentStep, totalSteps }: StepProgressProps) {
  const progress = (currentStep / totalSteps) * 100;

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium">
          Progress: {currentStep} of {totalSteps} steps
        </span>
        <span className="text-sm text-muted-foreground">
          {Math.round(progress)}%
        </span>
      </div>
      <Progress value={progress} className="h-2" />

      <div className="flex items-center justify-between mt-4">
        {Array.from({ length: totalSteps }, (_, i) => i + 1).map((step) => {
          const isCompleted = step < currentStep;
          const isCurrent = step === currentStep;

          return (
            <div
              key={step}
              className={cn(
                "flex flex-col items-center gap-1 flex-1",
                step < totalSteps && "border-r"
              )}
            >
              <div
                className={cn(
                  "w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium border-2 transition-colors",
                  isCompleted &&
                    "bg-primary text-primary-foreground border-primary",
                  isCurrent &&
                    "bg-primary text-primary-foreground border-primary ring-2 ring-primary ring-offset-2",
                  !isCompleted &&
                    !isCurrent &&
                    "bg-background border-muted text-muted-foreground"
                )}
              >
                {isCompleted ? (
                  <Check className="h-4 w-4" />
                ) : (
                  step
                )}
              </div>
              <span
                className={cn(
                  "text-xs",
                  isCurrent ? "font-medium" : "text-muted-foreground"
                )}
              >
                Step {step}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
