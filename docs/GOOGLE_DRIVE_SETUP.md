# Google Drive setup — detailed guide

This guide walks you through connecting **Google Drive** to **remote-work-helper** so the Chrome extension can:

1. Upload resume + cover letter to Google Drive (via your website API)
2. Save the job in **Resume DB** with Drive view links

---

## What you need before starting

- A Google account (personal or Workspace)
- Your site running locally (`npm run dev`) or deployed on Vercel
- Supabase already set up (Resume DB table + `resume-db` bucket) — see project README
- The extension pointed at your site URL in **Settings → Website connection**

---

## Part 1 — Google Cloud project

### Step 1.1: Open Google Cloud Console

1. Go to [https://console.cloud.google.com/](https://console.cloud.google.com/)
2. Sign in with the Google account that owns (or will own) the Drive folder.

### Step 1.2: Create a project (or pick an existing one)

1. Top bar → click the **project** dropdown.
2. Click **New Project**.
3. Name it e.g. `remote-work-helper`.
4. Click **Create** and wait until it is selected.

### Step 1.3: Enable Google Drive API

1. Left menu → **APIs & Services** → **Library**.
2. Search for **Google Drive API**.
3. Open it → click **Enable**.

---

## Part 2 — Service account (server identity)

The **website backend** uploads files using a **service account** (not your personal login).

### Step 2.1: Create the service account

1. **APIs & Services** → **Credentials**.
2. **+ Create Credentials** → **Service account**.
3. Name: e.g. `resume-db-drive-uploader`.
4. Click **Create and Continue** (roles optional — skip or use basic).
5. Click **Done**.

### Step 2.2: Create a JSON key

1. On **Credentials**, under **Service Accounts**, click the account you created.
2. Tab **Keys** → **Add Key** → **Create new key**.
3. Type: **JSON** → **Create**.
4. A `.json` file downloads. **Keep it secret** — treat it like a password.

### Step 2.3: Copy values from the JSON file

Open the JSON file in a text editor. You need two fields:

```json
{
  "client_email": "resume-db-drive-uploader@your-project.iam.gserviceaccount.com",
  "private_key": "-----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----\n"
}
```

| Env variable | JSON field |
|--------------|------------|
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | `client_email` |
| `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` | `private_key` |

---

## Part 3 — Google Drive folder

### Step 3.1: Create a folder

1. Open [https://drive.google.com/](https://drive.google.com/)
2. **New** → **Folder** → name it e.g. `Resume DB Uploads`.

### Step 3.2: Share the folder with the service account

1. Right-click the folder → **Share**.
2. In **Add people**, paste the **service account email** from `client_email`  
   (looks like `something@your-project.iam.gserviceaccount.com`).
3. Role: **Editor** (so the server can create files inside).
4. Uncheck **Notify people** (the service account is not a real inbox).
5. Click **Share** / **Send**.

> Without this step, uploads fail with permission errors.

### Step 3.3: Get the folder ID

1. Open the folder in Drive.
2. Look at the browser URL:

   `https://drive.google.com/drive/folders/1ABCdefGHIjkLmNoPqRsTuVwXyZ`

3. The part after `/folders/` is **`GOOGLE_DRIVE_FOLDER_ID`**:

   `1ABCdefGHIjkLmNoPqRsTuVwXyZ`

---

## Part 4 — Environment variables on the server

### Step 4.1: Local development (`.env.local`)

In your project root (`remote-work-helper`), create or edit **`.env.local`**:

```env
# Existing Supabase vars (you should already have these)
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# Google Drive (new)
GOOGLE_SERVICE_ACCOUNT_EMAIL=resume-db-drive-uploader@your-project.iam.gserviceaccount.com
GOOGLE_DRIVE_FOLDER_ID=1ABCdefGHIjkLmNoPqRsTuVwXyZ
```

**Private key** — two options:

**Option A — single line with `\n` (recommended for Vercel):**

```env
GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBg...(all one line)...\n-----END PRIVATE KEY-----\n"
```

Copy the `private_key` value from JSON and replace real newlines with `\n`.

**Option B — multiline in `.env.local` only:**

Some tools support a literal multiline key in quotes; if `npm run dev` fails to parse it, use Option A.

### Step 4.2: Restart the dev server

```bash
npm run dev
```

Env changes are not picked up until you restart.

### Step 4.3: Vercel (production)

1. Vercel dashboard → your project → **Settings** → **Environment Variables**.
2. Add the same three variables for **Production** (and Preview if you use it).
3. For `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`, paste the **one-line `\n` version**.
4. **Redeploy** the project (Deployments → … → Redeploy).

---

## Part 5 — Verify the server

### Step 5.1: Health check

**Local:**

```text
http://localhost:3000/api/health
```

**Production:**

```text
https://remote-work-helper.vercel.app/api/health
```

Expected:

```json
{
  "ok": true,
  "service": "remote-work-helper",
  "googleDrive": { "configured": true }
}
```

If `"configured": false`, the email or private key env vars are missing or empty on that deployment.

### Step 5.2: Extension Register tab

1. Reload the extension at `chrome://extensions`.
2. Open the side panel → **Job Register**.
3. After connection check you should see:
   - **Connected · … · Drive ready**
   - **Google Drive upload enabled**

---

## Part 6 — Extension settings

1. Side panel → **Settings** (gear) or open Settings tab.
2. **Website connection**:
   - **Backend URL:** `http://localhost:3000` (local) or your Vercel URL (prod).
   - **API key:** only if you set `EXTENSION_API_KEY` on the server; must match in extension.
3. Click **Save connection** → **Test connection**.

---

## Part 7 — End-to-end test

1. Open a job posting page in Chrome.
2. Extension → **Job Register** → **Scrape** (or header **↻**).
3. Fill **Candidate**, attach **Resume** (required), optional **Cover**.
4. Click **Register**.

You should see:

1. `Uploading resume & cover letter to Google Drive…`
2. `Registered (#…). Files saved on Google Drive.`

Then on the website **Resume DB** page:

- New row with **Google Drive** links for resume / cover letter.
- Files appear inside your shared Drive folder.

---

## Optional: Extension API key

If you set `EXTENSION_API_KEY` on the server, the extension must send the same value:

1. Server `.env.local` / Vercel: `EXTENSION_API_KEY=your-secret-string`
2. Extension **Settings** → **API key** → paste the same string → Save.

If you do **not** set `EXTENSION_API_KEY`, the API accepts requests without a key (fine for local dev only).

---

## Troubleshooting

| Symptom | What to check |
|--------|----------------|
| `googleDrive.configured: false` | Email and private key env vars on the deployment you are hitting |
| `Google Drive is not configured on the server` | Same as above; restart dev server or redeploy Vercel |
| `403` / permission / `insufficientPermissions` | Folder shared with service account email as **Editor**; correct `GOOGLE_DRIVE_FOLDER_ID` |
| `Invalid grant` / key errors | Private key copied completely; use `\n` for newlines on Vercel |
| Extension “Not connected” | Backend URL, site running, CORS — test `/api/health` in browser |
| Upload works but parse fails later | Drive link must be viewable; server uses Drive API when configured |

---

## Security notes

- Never commit the JSON key or `.env.local` to git.
- Restrict who can access the shared Drive folder in production.
- Use `EXTENSION_API_KEY` on public deployments.

---

## Quick reference — env vars

| Variable | Required | Example |
|----------|----------|---------|
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Yes | `uploader@project.iam.gserviceaccount.com` |
| `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` | Yes | `-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n` |
| `GOOGLE_DRIVE_FOLDER_ID` | Recommended | `1ABC...xyz` from folder URL |
