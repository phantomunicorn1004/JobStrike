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
| `lever-sample.html` | `lever` | `#application-form` |
| `ashby-sample.html` | `ashby` | `main form` |
| `smartrecruiters-sample.html` | `smartrecruiters` | `[data-automation="job-application-form"]` |
| `rippling-sample.html` | `rippling` | `form` with `[data-testid="input-first_name"]` |
| `workday-sample.html` | `workday` | `[data-automation-id="applyFlowPage"]` / `applyFlowMyInfoPage` |

Footer inputs outside the application form should be excluded when scoped scan is active.
