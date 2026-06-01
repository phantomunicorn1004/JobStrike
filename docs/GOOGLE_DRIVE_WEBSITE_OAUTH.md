# Google Drive — website OAuth (per user)

Uploads from the **Chrome extension** go through the **website API**. Each member connects **their own Gmail** once on the website.

## Setup

### 1. SQL migration

Run in Supabase SQL editor:

`scripts/add-google-drive-to-app-users.sql`

### 2. Google Cloud OAuth client (Web application)

1. [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → Credentials
2. Create **OAuth client ID** → **Web application**
3. Authorized redirect URIs:

   - Local: `http://localhost:3000/api/integrations/google-drive/callback`
   - Production: `https://YOUR_DOMAIN/api/integrations/google-drive/callback`

### 3. Environment variables

```env
GOOGLE_OAUTH_CLIENT_ID=....apps.googleusercontent.com
GOOGLE_OAUTH_CLIENT_SECRET=...
# Optional override:
# GOOGLE_OAUTH_REDIRECT_URI=https://your-domain/api/integrations/google-drive/callback
NEXT_PUBLIC_APP_URL=https://your-domain
```

Optional **service account** fallback (team folder):

```env
GOOGLE_SERVICE_ACCOUNT_EMAIL=...
GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
GOOGLE_DRIVE_FOLDER_ID=...
```

### 4. Website

1. Sign in as a **member**
2. Open **Settings** → **Connect Google Drive**
3. Set optional upload folder ID and default resume/cover links

### 5. Extension

1. Settings → **Website connection** → sign in (same member account)
2. Job Register → attach files → **Register to DB** (no extension Google OAuth)

## API

| Route | Purpose |
|-------|---------|
| `GET /api/integrations/google-drive/status` | Connection + defaults (extension uses this) |
| `PATCH /api/integrations/google-drive/status` | Save folder ID + default URLs |
| `GET /api/integrations/google-drive/connect` | Start OAuth (browser) |
| `GET /api/integrations/google-drive/callback` | OAuth callback |
| `POST /api/integrations/google-drive/disconnect` | Clear tokens |

`POST /api/resume-db/register` accepts `resume` and `coverLetter` files and uploads with the member’s connected Drive (or service account / Supabase fallback).
