"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

type StepTemplateSelectProps = {
  data: {
    selectedTemplate: string | null;
    fileFormat: "pdf" | "docx";
  };
  updateData: (updates: Partial<any>) => void;
};

import { TEMPLATE_CONFIGS, type TemplateId } from "@/lib/resumeTemplates/types";

const templates = Object.values(TEMPLATE_CONFIGS).map((config) => ({
  id: config.id,
  name: config.name,
  description: config.description,
  preview: config.id === "modern" ? "📄" : config.id === "classic" ? "📋" : config.id === "creative" ? "🎨" : "✨",
}));

export function StepTemplateSelect({ data, updateData }: StepTemplateSelectProps) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold mb-4">Choose Resume Template</h2>
        <p className="text-sm text-muted-foreground mb-6">
          Select a template and file format for your resume.
        </p>
      </div>

      <div>
        <Label className="mb-4 block">Select Template *</Label>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {templates.map((template) => {
            const isSelected = data.selectedTemplate === template.id;
            return (
              <Card
                key={template.id}
                className={cn(
                  "cursor-pointer transition-all hover:border-primary",
                  isSelected && "border-primary ring-2 ring-primary ring-offset-2"
                )}
                onClick={() => updateData({ selectedTemplate: template.id })}
              >
                <CardContent className="pt-6">
                  <div className="text-center space-y-2">
                    <div className="text-4xl mb-2">{template.preview}</div>
                    <div className="font-medium">{template.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {template.description}
                    </div>
                    {isSelected && (
                      <div className="flex justify-center mt-2">
                        <Badge variant="default" className="text-xs">
                          <Check className="h-3 w-3 mr-1" />
                          Selected
                        </Badge>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      <div>
        <Label className="mb-4 block">File Format *</Label>
        <RadioGroup
          value={data.fileFormat}
          onValueChange={(value) =>
            updateData({ fileFormat: value as "pdf" | "docx" })
          }
        >
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="pdf" id="pdf" />
            <Label htmlFor="pdf" className="font-normal cursor-pointer">
              PDF
            </Label>
          </div>
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="docx" id="docx" />
            <Label htmlFor="docx" className="font-normal cursor-pointer">
              DOCX
            </Label>
          </div>
        </RadioGroup>
      </div>

      {data.selectedTemplate && (
        <div className="bg-muted/50 p-4 rounded-lg">
          <p className="text-sm">
            <strong>Selected:</strong> {templates.find((t) => t.id === data.selectedTemplate)?.name} template
            {" • "}
            {data.fileFormat.toUpperCase()} format
          </p>
        </div>
      )}
    </div>
  );
}
