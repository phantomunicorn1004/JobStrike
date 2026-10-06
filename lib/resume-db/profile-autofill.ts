/**
 * Application-form answers stored per profile (`profiles.autofill`).
 *
 * This list is the single definition of those fields: the profile page renders
 * its inputs from it and the API accepts only these keys. Keys match the
 * extension's autofill profile so a value saved here fills forms unchanged.
 */

export type ProfileAutofill = Record<string, string>;

export type AutofillFieldOption = { value: string; label: string };

export type AutofillFieldDef = {
  key: string;
  label: string;
  kind: "text" | "select" | "textarea";
  placeholder?: string;
  /** Shown under the input: what the value is used for. */
  hint?: string;
  options?: AutofillFieldOption[];
  /** Pre-selected for a new profile; the stored value still wins. */
  defaultValue?: string;
};

export type AutofillFieldGroup = {
  id: string;
  title: string;
  description: string;
  fields: AutofillFieldDef[];
};

const UNSET: AutofillFieldOption = { value: "", label: "— Not set —" };
const YES_NO: AutofillFieldOption[] = [
  UNSET,
  { value: "Yes", label: "Yes" },
  { value: "No", label: "No" },
];
const YES_NO_DECLINE: AutofillFieldOption[] = [
  ...YES_NO,
  { value: "Prefer not to answer", label: "Prefer not to answer" },
];

export const PROFILE_AUTOFILL_GROUPS: AutofillFieldGroup[] = [
  {
    id: "eligibility",
    title: "Work eligibility",
    description:
      "Asked on almost every application. Also used by the compatibility check to decide which jobs to skip.",
    fields: [
      {
        key: "workAuthorizationUS",
        label: "Authorized to work in the US",
        kind: "select",
        options: YES_NO,
        defaultValue: "Yes",
      },
      {
        key: "sponsorshipRequirement",
        label: "Needs visa sponsorship (now or later)",
        kind: "select",
        options: YES_NO,
        defaultValue: "No",
      },
      {
        key: "citizenship",
        label: "Citizenship",
        kind: "text",
        placeholder: "US citizen",
        defaultValue: "US citizen",
      },
      {
        key: "securityClearance",
        label: "Active security clearance",
        kind: "text",
        placeholder: "No",
        defaultValue: "No",
        hint: "Write the level if one is held, e.g. Secret.",
      },
      {
        key: "languages",
        label: "Spoken languages",
        kind: "text",
        placeholder: "English",
        defaultValue: "English",
      },
      {
        key: "country",
        label: "Country of residence",
        kind: "text",
        placeholder: "United States",
        defaultValue: "United States",
      },
      {
        key: "relocationPreference",
        label: "Willing to relocate",
        kind: "select",
        options: YES_NO,
      },
    ],
  },
  {
    id: "contact",
    title: "Contact and links",
    description: "Fills the top of the form. Leave a link empty if there is none.",
    fields: [
      {
        key: "firstName",
        label: "First name",
        kind: "text",
        placeholder: "Defaults to the first word of Full name",
      },
      { key: "middleName", label: "Middle name", kind: "text" },
      {
        key: "lastName",
        label: "Last name",
        kind: "text",
        placeholder: "Defaults to the rest of Full name",
      },
      {
        key: "applicationEmail",
        label: "Email for applications",
        kind: "text",
        placeholder: "Defaults to the first work email",
      },
      { key: "preferredName", label: "Preferred first name", kind: "text" },
      { key: "pronouns", label: "Pronouns", kind: "text", placeholder: "e.g. He/Him" },
      { key: "github", label: "GitHub URL", kind: "text", placeholder: "https://github.com/…" },
      {
        key: "portfolio",
        label: "Portfolio or website",
        kind: "text",
        placeholder: "https://…",
      },
    ],
  },
  {
    id: "work",
    title: "Current work",
    description: "Answers experience and logistics questions.",
    fields: [
      { key: "currentTitle", label: "Current job title", kind: "text" },
      { key: "currentCompany", label: "Current company", kind: "text" },
      {
        key: "yearsOfExperience",
        label: "Years of professional experience",
        kind: "text",
        placeholder: "e.g. 7",
      },
      {
        key: "desiredSalary",
        label: "Desired salary",
        kind: "text",
        placeholder: "e.g. $150,000",
      },
      {
        key: "noticePeriod",
        label: "Notice period / start date",
        kind: "text",
        placeholder: "e.g. 2 weeks",
      },
      {
        key: "howDidYouHear",
        label: "“How did you hear about us?”",
        kind: "text",
        placeholder: "e.g. LinkedIn",
      },
    ],
  },
  {
    id: "education",
    title: "Education",
    description: "Forms ask for these separately, so keep the school name free of years.",
    fields: [
      {
        key: "school",
        label: "School name",
        kind: "text",
        placeholder: "Defaults to University, without the years",
      },
      {
        key: "highestEducation",
        label: "Highest level completed",
        kind: "select",
        options: [
          UNSET,
          { value: "High School", label: "High school" },
          { value: "Associate's Degree", label: "Associate's" },
          { value: "Bachelor's Degree", label: "Bachelor's" },
          { value: "Master's Degree", label: "Master's" },
          { value: "Doctorate", label: "Doctorate (PhD)" },
        ],
      },
      { key: "degree", label: "Degree", kind: "text", placeholder: "e.g. B.S." },
      { key: "major", label: "Major / discipline", kind: "text", placeholder: "e.g. Computer Science" },
      { key: "educationStartYear", label: "Start year", kind: "text", placeholder: "e.g. 2013" },
      { key: "graduationYear", label: "Graduation year", kind: "text", placeholder: "e.g. 2017" },
    ],
  },
  {
    id: "demographics",
    title: "Voluntary self-identification",
    description:
      "These questions are optional on every form. Anything left as “Not set” is not answered; nothing is assumed.",
    fields: [
      {
        key: "gender",
        label: "Gender",
        kind: "select",
        options: [
          UNSET,
          { value: "Male", label: "Male" },
          { value: "Female", label: "Female" },
          { value: "Non-binary", label: "Non-binary" },
          { value: "Prefer not to answer", label: "Prefer not to answer" },
        ],
      },
      {
        key: "race",
        label: "Race / ethnicity",
        kind: "select",
        options: [
          UNSET,
          { value: "American Indian or Alaska Native", label: "American Indian or Alaska Native" },
          { value: "Asian", label: "Asian" },
          { value: "Black or African American", label: "Black or African American" },
          { value: "Hispanic or Latino", label: "Hispanic or Latino" },
          {
            value: "Native Hawaiian or Other Pacific Islander",
            label: "Native Hawaiian or Other Pacific Islander",
          },
          { value: "White", label: "White" },
          { value: "Two or More Races", label: "Two or more races" },
          { value: "Prefer not to answer", label: "Prefer not to answer" },
        ],
      },
      {
        key: "hispanicLatino",
        label: "Hispanic or Latino",
        kind: "select",
        options: YES_NO_DECLINE,
      },
      {
        key: "veteranStatus",
        label: "Protected veteran",
        kind: "select",
        options: YES_NO_DECLINE,
      },
      {
        key: "disabilityStatus",
        label: "Disability",
        kind: "select",
        options: YES_NO_DECLINE,
      },
    ],
  },
  {
    id: "ai",
    title: "Extra facts for AI answers",
    description:
      "The AI may only state what it is given. Add anything it should know when answering open questions.",
    fields: [
      {
        key: "extraFacts",
        label: "Facts the AI may use",
        kind: "textarea",
        placeholder:
          "Skill levels (Python 4/5, Ruby 2/5), notable projects, certifications, why this kind of role…",
        hint: "Plain sentences work best. Do not put anything here you would not want on an application.",
      },
    ],
  },
];

export const PROFILE_AUTOFILL_FIELDS: AutofillFieldDef[] = PROFILE_AUTOFILL_GROUPS.flatMap(
  (group) => group.fields,
);

const MAX_VALUE_CHARS = 300;
const MAX_TEXTAREA_CHARS = 4000;

/** Keep known keys only, as trimmed strings; a select must hold one of its options. */
export function sanitizeProfileAutofill(raw: unknown): ProfileAutofill {
  const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out: ProfileAutofill = {};
  for (const field of PROFILE_AUTOFILL_FIELDS) {
    const value = String(source[field.key] ?? "").trim();
    if (!value) continue;
    if (field.kind === "select" && !field.options?.some((option) => option.value === value)) {
      continue;
    }
    out[field.key] = value.slice(0, field.kind === "textarea" ? MAX_TEXTAREA_CHARS : MAX_VALUE_CHARS);
  }
  return out;
}

/** Values for a brand-new profile: every field empty except the stated defaults. */
export function defaultProfileAutofill(): ProfileAutofill {
  const out: ProfileAutofill = {};
  for (const field of PROFILE_AUTOFILL_FIELDS) {
    if (field.defaultValue) out[field.key] = field.defaultValue;
  }
  return out;
}

export function countFilledAutofill(values: ProfileAutofill | null | undefined): number {
  if (!values) return 0;
  return PROFILE_AUTOFILL_FIELDS.filter((field) => String(values[field.key] ?? "").trim()).length;
}
