# Resume Template DOCX Guide

## Overview

This project supports custom DOCX resume templates with placeholder variables using the `<<variable>>` syntax. Templates allow you to design your own resume layout while the system fills in the tailored content.

## Available Placeholder Variables

### Basic Fields

- `<<profileTitle>>` - The candidate's name/heading
- `<<professionalSummary>>` - Tailored professional summary (2-3 sentences)

### Contact Information (Optional)

- `<<contactInfo>>` - Contact details (email, phone, address, etc.)

### Experience Section

- `<<experience>>` - Full experience section with all jobs
- `<<experience.jobTitle>>` - Job title for current experience entry
- `<<experience.company>>` - Company name for current experience entry
- `<<experience.bullets>>` - Bullet points for current experience entry

**Note:** Experience fields work in loops. Use `<<experience>>` to iterate through all experience entries.

### Skills (Optional)

- `<<skills>>` - All skills as comma-separated list
- `<<skills.list>>` - Skills as a formatted list (one per line)

### Education (Optional)

- `<<education>>` - All education entries
- `<<education.entry>>` - Single education entry

### Certifications (Optional)

- `<<certifications>>` - All certifications
- `<<certifications.entry>>` - Single certification entry

## Template Structure Example

Here's a basic template structure you can use:

```
<<profileTitle>>

<<contactInfo>>

PROFESSIONAL SUMMARY
<<professionalSummary>>

PROFESSIONAL EXPERIENCE
<<experience>>
<<experience.jobTitle>> | <<experience.company>>
• <<experience.bullets>>

TECHNICAL SKILLS
<<skills>>

EDUCATION
<<education>>

CERTIFICATIONS
<<certifications>>
```

## Step-by-Step Template Creation

### 1. Create a DOCX File

1. Open Microsoft Word or Google Docs
2. Create a new document
3. Design your resume layout with:
   - Headers and sections
   - Fonts and formatting
   - Spacing and alignment
   - Borders or styling (optional)

### 2. Insert Placeholders

1. Where you want content to appear, type the placeholder:
   - Example: `<<profileTitle>>`
   - Example: `<<professionalSummary>>`

2. **Important:** Use double angle brackets `<<` and `>>` exactly as shown

3. You can format the placeholder text:
   - Make it bold, italic, or different font size
   - The formatting will be preserved for the inserted content

### 3. Experience Section Format

For experience entries, you have two options:

**Option A: Full experience block (simpler)**
```
PROFESSIONAL EXPERIENCE
<<experience>>
```

**Option B: Custom format per entry**
```
PROFESSIONAL EXPERIENCE

<<experience.jobTitle>> | <<experience.company>>
<<experience.bullets>>
```

### 4. Skills Format

**Option A: Comma-separated**
```
Skills: <<skills>>
```

**Option B: Line-separated list**
```
<<skills.list>>
```

### 5. Save as DOCX

1. Save your document as `.docx` format
2. Use a descriptive filename (e.g., `modern-resume-template.docx`)
3. Ensure the file is not password-protected

## Template Best Practices

### ✅ Do's

- Use consistent placeholder syntax: `<<variable>>`
- Design for ATS compatibility:
  - Simple, clean layouts
  - Standard fonts (Arial, Calibri, Times New Roman)
  - No complex tables or graphics
  - Standard section headers
- Test with sample data before uploading
- Keep placeholders on their own lines for better text replacement

### ❌ Don'ts

- Don't use single brackets: `<variable>` (won't work)
- Don't use spaces in variable names: `<<profile Title>>` (wrong)
- Don't use nested brackets: `<<experience<<jobTitle>>>>` (wrong)
- Don't include images or complex graphics (may not render correctly)
- Don't password-protect the template

## Complete Example Template

```
<<profileTitle>>
<<contactInfo>>

─────────────────────────────────────────────────────────

PROFESSIONAL SUMMARY

<<professionalSummary>>

─────────────────────────────────────────────────────────

PROFESSIONAL EXPERIENCE

<<experience>>
<<experience.jobTitle>> | <<experience.company>>
<<experience.bullets>>

─────────────────────────────────────────────────────────

TECHNICAL SKILLS

<<skills>>

─────────────────────────────────────────────────────────

EDUCATION

<<education>>

─────────────────────────────────────────────────────────

CERTIFICATIONS

<<certifications>>
```

## Uploading Your Template

1. Go to Resume Tailor Settings
2. Click "Resume Templates" section
3. Click "Upload Template"
4. Select your `.docx` file
5. Template will be saved and available for use

## Notes

- **Current Status**: Template upload UI exists, but placeholder replacement logic may need implementation depending on your codebase version
- **Format Support**: Only `.docx` format is supported (not `.doc` or `.pdf`)
- **File Size**: Keep templates under 5MB
- **Testing**: Upload a test template and generate a resume to verify placeholders work correctly

## Troubleshooting

**Placeholders not being replaced?**
- Check spelling and syntax: `<<variable>>` (exact match)
- Ensure you're using the correct variable names
- Verify the template was saved as `.docx` format

**Formatting issues?**
- Simple layouts work best
- Avoid complex Word features (macros, embedded objects)
- Test with different content lengths

**Template not uploading?**
- Ensure file is `.docx` format
- Check file size (under 5MB)
- Verify file is not corrupted
