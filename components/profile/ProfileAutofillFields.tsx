"use client";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  PROFILE_AUTOFILL_GROUPS,
  type AutofillFieldDef,
  type ProfileAutofill,
} from "@/lib/resume-db/profile-autofill";

type Props = {
  values: ProfileAutofill;
  onChange: (key: string, value: string) => void;
  /** Keeps input ids unique when several profiles are on the page. */
  idPrefix: string;
};

const SELECT_CLASS =
  "border-input h-9 w-full min-w-0 rounded-md border bg-card px-3 py-1 text-base shadow-xs outline-none md:text-sm dark:bg-input/30 focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]";

function FieldControl({
  field,
  id,
  value,
  onChange,
}: {
  field: AutofillFieldDef;
  id: string;
  value: string;
  onChange: (value: string) => void;
}) {
  if (field.kind === "select") {
    return (
      <select
        id={id}
        className={SELECT_CLASS}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {(field.options ?? []).map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  }
  if (field.kind === "textarea") {
    return (
      <Textarea
        id={id}
        rows={4}
        value={value}
        placeholder={field.placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  return (
    <Input
      id={id}
      value={value}
      placeholder={field.placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/**
 * Inputs for the answers the extension uses to fill application forms.
 * Grouped and collapsed so the common ones are one click away and the long
 * tail does not bury the core profile fields above it.
 */
export function ProfileAutofillFields({ values, onChange, idPrefix }: Props) {
  return (
    <div className="rounded-md border border-border">
      <div className="border-b border-border px-3 py-2">
        <p className="text-sm font-semibold">Autofill details</p>
        <p className="text-xs text-muted-foreground">
          Used by the extension to fill application forms. Anything left empty is not filled.
        </p>
      </div>
      <Accordion type="multiple" defaultValue={["eligibility"]} className="px-3">
        {PROFILE_AUTOFILL_GROUPS.map((group) => {
          const filled = group.fields.filter((f) => String(values[f.key] ?? "").trim()).length;
          return (
            <AccordionItem key={group.id} value={group.id}>
              <AccordionTrigger className="py-3 text-sm">
                <span className="flex min-w-0 flex-1 items-baseline justify-between gap-3 pr-2">
                  <span className="truncate">{group.title}</span>
                  <span className="shrink-0 text-xs font-normal text-muted-foreground tabular-nums">
                    {filled} of {group.fields.length}
                  </span>
                </span>
              </AccordionTrigger>
              <AccordionContent>
                <p className="mb-3 text-xs text-muted-foreground">{group.description}</p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {group.fields.map((field) => {
                    const id = `${idPrefix}-${field.key}`;
                    return (
                      <div
                        key={field.key}
                        className={
                          field.kind === "textarea" ? "grid gap-1.5 sm:col-span-2" : "grid gap-1.5"
                        }
                      >
                        <Label htmlFor={id}>{field.label}</Label>
                        <FieldControl
                          field={field}
                          id={id}
                          value={values[field.key] ?? ""}
                          onChange={(value) => onChange(field.key, value)}
                        />
                        {field.hint ? (
                          <p className="text-xs text-muted-foreground">{field.hint}</p>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </AccordionContent>
            </AccordionItem>
          );
        })}
      </Accordion>
    </div>
  );
}
