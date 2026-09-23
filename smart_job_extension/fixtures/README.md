# ATS fixtures (Phase 0)

Static HTML pages for manual adapter testing without a live job posting.

## How to use

1. Reload the extension in `chrome://extensions`.
2. Open a fixture file in Chrome (`file://` or drag into the browser).
3. Open the side panel → **Adapter detection** → **Refresh detection**, or run **Autofill this page**.

## Files

| File | Expected adapter | Scan root |
|------|------------------|-----------|
| `greenhouse-sample.html` | `greenhouse` | `#application_form` |
| `greenhouse-job-posting-sample.html` | `greenhouse` | `.job__description` / `main.job-post` |
| `lever-sample.html` | `lever` | `#application-form` |
| `lever-job-posting-sample.html` | `lever` | `.posting-page` / `[data-qa="job-description"]` |
| `ashby-sample.html` | `ashby` | `main form` |
| `ashby-job-posting-sample.html` | `ashby` | `#overview` / `[class*="descriptionText"]` |
| `bamboohr-job-posting-sample.html` | `bamboohr` | `.BambooRichText` / `[data-fabric-component="Headline"]` |
| `smartrecruiters-sample.html` | `smartrecruiters` | `[data-automation="job-application-form"]` |
| `smartrecruiters-job-posting-sample.html` | `smartrecruiters` | `main.jobad-main` / `[itemprop="description"]` |
| `rippling-sample.html` | `rippling` | `form` with `[data-testid="input-first_name"]` |
| `rippling-job-posting-sample.html` | `rippling` | `.ATS_htmlPreview` / `[data-testid="breadcrumb"]` |
| `workday-sample.html` | `workday` | `[data-automation-id="applyFlowPage"]` / `applyFlowMyInfoPage` |
| `workday-job-posting-sample.html` | `workday` | `[data-automation-id="jobPostingPage"]` / `jobPostingDescription` |

Footer inputs outside the application form should be excluded when scoped scan is active.
