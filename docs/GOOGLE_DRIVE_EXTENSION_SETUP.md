# Google Drive extension setup — detailed guide

Upload resume and cover letter from the **Chrome extension** to **your** Google Drive, then save **sharing links** to Resume DB on your website. The server does not need Google credentials.

---

## What you are setting up

| Step | Where | What happens |
|------|--------|----------------|
| 1 | Google Cloud | OAuth app so the extension can access your Drive |
| 2 | Extension Settings | Paste Client ID + redirect URI |
| 3 | Extension | Connect Google account (one-time sign-in) |
| 4 | Job Register | Upload tailored files **or** use Default links → Register |

---

## Part A — Extension ID and redirect URI (do this first)

You need these **before** creating the OAuth client in Google Cloud.

### A1. Open Chrome extensions

1. Open Chrome.
2. Go to `chrome://extensions`
3. Turn on **Developer mode** (top-right).

### A2. Find Smart Job Autofill Assistant

1. Find **Smart Job Autofill Assistant** in the list.
2. Copy the **ID** (long string like `abcdefghijklmnopqrstuvwxyzabcdef`).

### A3. Get the redirect URI from the extension

1. Click the extension icon → open the **side panel**.
2. Open **Settings** (gear in the header, or Settings tab).
3. Scroll to **Google Drive (Resume DB uploads)**.
4. Find **OAuth redirect URI** — it looks like:

   ```text
   https://abcdefghijklmnopqrstuvwxyzabcdef.chromiumapp.org/
   ```

5. **Copy that entire URL** (you will paste it into Google Cloud in Part C).

> If the redirect URI box shows `—`, reload the extension on `chrome://extensions` and open Settings again.

---

## Part B — Google Cloud project

### B1. Open Google Cloud Console

1. Go to [https://console.cloud.google.com/](https://console.cloud.google.com/)
2. Sign in with the Google account that owns the Drive where files should go.

### B2. Create or select a project

1. Top bar → click the **project** name.
2. **New Project** → name e.g. `Smart Job Autofill` → **Create**.
3. Wait until the new project is selected.

### B3. Enable Google Drive API

1. Left menu → **APIs & Services** → **Library**.
2. Search: `Google Drive API`.
3. Click **Google Drive API** → **Enable**.

---

## Part C — OAuth consent screen (required before Client ID)

### C1. Configure consent screen

1. **APIs & Services** → **OAuth consent screen**.
2. User type: **External** (unless you use Google Workspace and want Internal only).
3. Click **Create**.

### C2. App information

1. **App name:** e.g. `Smart Job Autofill`
2. **User support email:** your email
3. **Developer contact:** your email
4. Click **Save and Continue**.

### C3. Scopes

1. **Add or Remove Scopes**.
2. Find and add: `.../auth/drive.file`  
   (Shown as “See, edit, create, and delete only the specific Google Drive files you use with this app”.)
3. **Update** → **Save and Continue**.

### C4. Test users (while app is in “Testing”)

1. **Add users** → add your Gmail address.
2. **Save and Continue** through the summary.

> In Testing mode, only listed test users can sign in. That is fine for personal use.

---

## Part D — OAuth Client ID (steps 1–3 in the quick guide)

### D1. Create OAuth client

1. **APIs & Services** → **Credentials**.
2. **+ Create Credentials** → **OAuth client ID**.
3. Application type: **Web application** (not “Chrome extension” for this flow).
4. Name: e.g. `Smart Job Extension`.

### D2. Add redirect URI (critical)

1. Under **Authorized redirect URIs** → **+ Add URI**.
2. Paste the URI from **Part A3** exactly, e.g.:

   ```text
   https://YOUR_EXTENSION_ID.chromiumapp.org/
   ```

3. No extra spaces; include `https://` and trailing `/` if shown in the extension.

### D3. Create and copy Client ID

1. Click **Create**.
2. Copy the **Client ID** (ends with `.apps.googleusercontent.com`).
3. Keep the popup or note it — you will paste this into the extension.

---

## Part E — Extension Settings (step 3 in the quick guide)

### E1. Reload extension

1. `chrome://extensions` → **Reload** on Smart Job Autofill Assistant.

### E2. Open Google Drive settings

1. Extension side panel → **Settings**.
2. Card: **Google Drive (Resume DB uploads)**.

### E3. Fill in fields

| Field | What to enter |
|-------|----------------|
| **OAuth Client ID** | Paste from Part D3 |
| **Upload folder ID** | Optional — see below |
| **Default resume sharing link** | Optional — Drive link to your master resume |
| **Default cover letter sharing link** | Optional — Drive link to your master cover letter |

**Upload folder ID (optional):**

1. In [Google Drive](https://drive.google.com/), open the folder where uploads should go.
2. URL: `https://drive.google.com/drive/folders/1ABCxyz...`
3. Copy the part after `/folders/` → paste into **Upload folder ID**.

### E4. Save and connect

1. Click **Save Drive settings**.
2. Click **Connect Google Drive**.
3. Google sign-in window opens → choose your account → **Allow**.
4. Status should show: **Google account connected** (green dot).

If you see `redirect_uri_mismatch`:

- The URI in Google Cloud must **exactly** match the extension’s OAuth redirect URI (Part A3).

---

## Part F — Website connection (Resume DB)

The extension still needs your website API for candidates and registration.

1. Settings → **Website connection (Resume DB)**.
2. **Backend URL:**
   - Local: `http://localhost:3000`
   - Production: `https://remote-work-helper.vercel.app`
3. **API key:** only if you set `EXTENSION_API_KEY` on the server.
4. **Save connection** → **Test connection** → should show **Connected**.

---

## Part G — Register a job (end-to-end test)

### G1. Prepare

1. Open a job posting in Chrome.
2. Side panel → **Job Register**.
3. Check status:
   - **Connected · …** (website)
   - **Google Drive ready** (extension)

### G2. Scrape job info

1. Click **Scrape** or header **↻ Refresh**.
2. Job title, company, and link should fill in.
3. Select **Candidate** from the dropdown.

### G3. Resume and cover letter

**Tailored (new files for this job):**

1. Leave **Default** unchecked.
2. Drop or browse resume (required) and optional cover letter.
3. On Register, the extension uploads to Drive and creates sharing links.

**Original / default files:**

1. Check **Default** on Resume and/or Cover.
2. Extension uses the **default sharing links** from Settings (no upload for that file).
3. You must have saved those links in Part E3.

### G4. Register

1. Click **Register**.
2. Expected messages:
   - `Uploading to Google Drive & saving to Resume DB…`
   - `Registered (#…). Drive links saved.`
3. On your site **Resume DB** page, the new row should show Drive links.

---

## Troubleshooting

| Error | Fix |
|-------|-----|
| `redirect_uri_mismatch` | Redirect URI in Google Cloud must match extension Settings exactly |
| `Access blocked` / app not verified | Add your Gmail under OAuth consent screen → **Test users** |
| `Google Drive module failed to load` | Reload extension; check `google-drive.js` is in the extension folder |
| `Configure Google Drive in Settings` | Paste OAuth Client ID and Save |
| `Connect Google Drive before uploading` | Click **Connect Google Drive** after saving Client ID |
| `Default resume sharing link is empty` | Paste default link in Settings or uncheck **Default** and upload a file |
| Website not connected | Fix Backend URL; run `npm run dev` or deploy Vercel |
| Upload works but link does not open | File should be shared “anyone with the link” (extension sets this automatically) |

---

## Quick checklist

- [ ] Extension ID copied from `chrome://extensions`
- [ ] Redirect URI copied from extension Settings → Google Drive
- [ ] Google Drive API enabled
- [ ] OAuth consent screen configured + test user added
- [ ] Web application OAuth client created with redirect URI
- [ ] Client ID pasted in extension → Save → Connect
- [ ] Website connection tested
- [ ] Test Register successful
