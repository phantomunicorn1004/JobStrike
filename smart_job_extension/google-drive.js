/**
 * Google Drive uploads from the extension (user OAuth).
 * Sharing links are sent to Resume DB on register.
 */
(function (global) {
  const CLIENT_ID_KEY = 'google_oauth_client_id';
  const FOLDER_ID_KEY = 'google_drive_folder_id';
  const DEFAULT_RESUME_URL_KEY = 'google_default_resume_url';
  const DEFAULT_COVER_URL_KEY = 'google_default_cover_url';
  const TOKEN_KEY = 'google_access_token';
  const TOKEN_EXPIRY_KEY = 'google_token_expiry';

  const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
  const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';

  function storageGet(keys) {
    return new Promise((resolve) => {
      chrome.storage.local.get(keys, resolve);
    });
  }

  function storageSet(data) {
    return new Promise((resolve) => {
      chrome.storage.local.set(data, resolve);
    });
  }

  function getRedirectUri() {
    return chrome.identity.getRedirectURL();
  }

  function normalizeShareUrl(url) {
    const trimmed = String(url || '').trim();
    if (!trimmed) return '';
    if (!/^https?:\/\//i.test(trimmed)) return '';
    return trimmed;
  }

  function fileIdFromShareUrl(url) {
    try {
      const u = new URL(url);
      const m = u.pathname.match(/\/file\/d\/([^/]+)/);
      if (m?.[1]) return m[1];
      const id = u.searchParams.get('id');
      if (id) return id;
    } catch {
      /* ignore */
    }
    return null;
  }

  function viewUrlFromFileId(fileId) {
    return `https://drive.google.com/file/d/${fileId}/view?usp=sharing`;
  }

  async function getDriveSettings() {
    const data = await storageGet([
      CLIENT_ID_KEY,
      FOLDER_ID_KEY,
      DEFAULT_RESUME_URL_KEY,
      DEFAULT_COVER_URL_KEY,
      TOKEN_KEY,
      TOKEN_EXPIRY_KEY,
    ]);
    return {
      clientId: String(data[CLIENT_ID_KEY] || '').trim(),
      folderId: String(data[FOLDER_ID_KEY] || '').trim(),
      defaultResumeUrl: normalizeShareUrl(data[DEFAULT_RESUME_URL_KEY]),
      defaultCoverUrl: normalizeShareUrl(data[DEFAULT_COVER_URL_KEY]),
      token: String(data[TOKEN_KEY] || '').trim(),
      tokenExpiry: Number(data[TOKEN_EXPIRY_KEY] || 0),
    };
  }

  async function saveDriveSettings({ clientId, folderId, defaultResumeUrl, defaultCoverUrl }) {
    await storageSet({
      [CLIENT_ID_KEY]: String(clientId || '').trim(),
      [FOLDER_ID_KEY]: String(folderId || '').trim(),
      [DEFAULT_RESUME_URL_KEY]: normalizeShareUrl(defaultResumeUrl),
      [DEFAULT_COVER_URL_KEY]: normalizeShareUrl(defaultCoverUrl),
    });
  }

  function isDriveConfigured(settings) {
    return Boolean(settings?.clientId);
  }

  function isDriveConnected(settings) {
    return Boolean(
      settings?.token && settings.tokenExpiry > Date.now() + 30_000,
    );
  }

  async function clearToken() {
    await storageSet({ [TOKEN_KEY]: '', [TOKEN_EXPIRY_KEY]: 0 });
  }

  async function getAccessToken(interactive = true) {
    const settings = await getDriveSettings();
    if (!settings.clientId) {
      throw new Error(
        'Set your Google OAuth Client ID in Settings → Google Drive, then click Connect.',
      );
    }

    if (settings.token && settings.tokenExpiry > Date.now() + 60_000) {
      return settings.token;
    }

    const redirectUri = getRedirectUri();
    const authUrl =
      'https://accounts.google.com/o/oauth2/v2/auth' +
      `?client_id=${encodeURIComponent(settings.clientId)}` +
      '&response_type=token' +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&scope=${encodeURIComponent(DRIVE_SCOPE)}` +
      '&prompt=consent';

    return new Promise((resolve, reject) => {
      chrome.identity.launchWebAuthFlow(
        { url: authUrl, interactive },
        async (responseUrl) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          try {
            const hash = new URL(responseUrl).hash.replace(/^#/, '');
            const params = new URLSearchParams(hash);
            const token = params.get('access_token');
            const expiresIn = parseInt(params.get('expires_in') || '3600', 10);
            if (!token) {
              const err = params.get('error_description') || params.get('error');
              reject(new Error(err || 'Google sign-in did not return a token.'));
              return;
            }
            const expiry = Date.now() + expiresIn * 1000;
            await storageSet({
              [TOKEN_KEY]: token,
              [TOKEN_EXPIRY_KEY]: expiry,
            });
            resolve(token);
          } catch (e) {
            reject(e instanceof Error ? e : new Error(String(e)));
          }
        },
      );
    });
  }

  async function uploadFileToDrive(file, accessToken, folderId) {
    const metadata = { name: file.name || 'document' };
    if (folderId) metadata.parents = [folderId];

    const boundary = 'smart_job_' + Date.now();
    const metaPart =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
      JSON.stringify(metadata) +
      '\r\n';
    const filePartHeader =
      `--${boundary}\r\nContent-Type: ${file.type || 'application/octet-stream'}\r\n\r\n`;
    const end = `\r\n--${boundary}--`;

    const fileBuffer = await file.arrayBuffer();
    const enc = new TextEncoder();
    const bodyParts = [
      enc.encode(metaPart),
      enc.encode(filePartHeader),
      new Uint8Array(fileBuffer),
      enc.encode(end),
    ];
    const totalLen = bodyParts.reduce((n, p) => n + p.byteLength, 0);
    const body = new Uint8Array(totalLen);
    let offset = 0;
    for (const part of bodyParts) {
      body.set(part, offset);
      offset += part.byteLength;
    }

    const createRes = await fetch(
      `${DRIVE_UPLOAD}?uploadType=multipart&fields=id,webViewLink`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body,
      },
    );

    const createData = await createRes.json().catch(() => ({}));
    if (!createRes.ok) {
      throw new Error(
        createData.error?.message ||
          `Google Drive upload failed (${createRes.status}).`,
      );
    }

    const fileId = createData.id;
    if (!fileId) throw new Error('Drive upload did not return a file id.');

    const permRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}/permissions`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ role: 'reader', type: 'anyone' }),
      },
    );

    if (!permRes.ok) {
      const permErr = await permRes.json().catch(() => ({}));
      throw new Error(
        permErr.error?.message ||
          'File uploaded but could not set sharing link. Share the file manually in Drive.',
      );
    }

    return createData.webViewLink || viewUrlFromFileId(fileId);
  }

  async function uploadApplicationFiles(resumeFile, coverFile) {
    const settings = await getDriveSettings();
    const token = await getAccessToken(true);
    const resumeUrl = await uploadFileToDrive(
      resumeFile,
      token,
      settings.folderId,
    );

    let coverLetterUrl = '';
    if (coverFile && coverFile.size > 0) {
      coverLetterUrl = await uploadFileToDrive(
        coverFile,
        token,
        settings.folderId,
      );
    }

    return { resumeUrl, coverLetterUrl };
  }

  async function resolveUrlsForRegister({
    resumeFile,
    coverFile,
    resumeIsDefault,
    coverIsDefault,
  }) {
    const settings = await getDriveSettings();

    let resumeUrl = '';
    let coverLetterUrl = '';

    if (resumeIsDefault) {
      if (!settings.defaultResumeUrl) {
        throw new Error(
          'Default resume sharing link is empty. Set it in Settings → Google Drive.',
        );
      }
      resumeUrl = settings.defaultResumeUrl;
    } else {
      if (!resumeFile) throw new Error('Select a resume file.');
      const token = await getAccessToken(true);
      resumeUrl = await uploadFileToDrive(resumeFile, token, settings.folderId);
    }

    if (coverIsDefault) {
      if (settings.defaultCoverUrl) {
        coverLetterUrl = settings.defaultCoverUrl;
      }
    } else if (coverFile && coverFile.size > 0) {
      const token = await getAccessToken(false);
      coverLetterUrl = await uploadFileToDrive(
        coverFile,
        token,
        settings.folderId,
      );
    }

    return { resumeUrl, coverLetterUrl };
  }

  function updateDriveSettingsUi() {
    getDriveSettings().then((s) => {
      const clientInput = document.getElementById('googleOAuthClientIdSetting');
      const folderInput = document.getElementById('googleDriveFolderIdSetting');
      const resumeInput = document.getElementById('googleDefaultResumeUrlSetting');
      const coverInput = document.getElementById('googleDefaultCoverUrlSetting');
      const redirectEl = document.getElementById('googleOAuthRedirectUri');
      const statusEl = document.getElementById('googleDriveConnectionLabel');
      const dotEl = document.getElementById('googleDriveConnectionDot');

      if (clientInput) clientInput.value = s.clientId;
      if (folderInput) folderInput.value = s.folderId;
      if (resumeInput) resumeInput.value = s.defaultResumeUrl;
      if (coverInput) coverInput.value = s.defaultCoverUrl;
      if (redirectEl) redirectEl.textContent = getRedirectUri();

      const configured = isDriveConfigured(s);
      const connected = isDriveConnected(s);

      if (statusEl) {
        if (!configured) {
          statusEl.textContent = 'Add OAuth Client ID below';
        } else if (connected) {
          statusEl.textContent = 'Google account connected';
        } else {
          statusEl.textContent = 'Saved — click Connect Google Drive';
        }
      }
      if (dotEl) {
        dotEl.className =
          'backend-connection-dot is-' +
          (connected ? 'ok' : configured ? 'checking' : 'error');
      }

      updateRegisterDriveBadge(s);
    });
  }

  function updateRegisterDriveBadge(settings) {
    const el = document.getElementById('registerDriveStatus');
    if (!el) return;
    const s = settings || null;
    getDriveSettings().then((cfg) => {
      const c = s || cfg;
      if (!isDriveConfigured(c)) {
        el.textContent = 'Configure Google Drive in Settings';
        el.className = 'register-drive-status is-off';
      } else if (!isDriveConnected(c)) {
        el.textContent = 'Connect Google Drive in Settings to upload files';
        el.className = 'register-drive-status is-off';
      } else {
        el.textContent = 'Google Drive ready — uploads use your account';
        el.className = 'register-drive-status is-ready';
      }
      el.hidden = false;
    });
  }

  function wireGoogleDriveSettings(showStatus) {
    const form = document.getElementById('googleDriveSettingsForm');
    const connectBtn = document.getElementById('connectGoogleDriveBtn');
    const disconnectBtn = document.getElementById('disconnectGoogleDriveBtn');

    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        await saveDriveSettings({
          clientId: document.getElementById('googleOAuthClientIdSetting')?.value,
          folderId: document.getElementById('googleDriveFolderIdSetting')?.value,
          defaultResumeUrl: document.getElementById('googleDefaultResumeUrlSetting')
            ?.value,
          defaultCoverUrl: document.getElementById('googleDefaultCoverUrlSetting')?.value,
        });
        const hint = document.getElementById('googleDriveSettingsHint');
        if (hint) {
          hint.textContent = 'Google Drive settings saved.';
          hint.className = 'muted register-settings-hint is-success';
          hint.hidden = false;
        }
        if (showStatus) showStatus('Google Drive settings saved.', 'success');
        updateDriveSettingsUi();
        updateRegisterDriveBadge();
      });
    }

    if (connectBtn) {
      connectBtn.addEventListener('click', async () => {
        const hint = document.getElementById('googleDriveSettingsHint');
        try {
          await saveDriveSettings({
            clientId: document.getElementById('googleOAuthClientIdSetting')?.value,
            folderId: document.getElementById('googleDriveFolderIdSetting')?.value,
            defaultResumeUrl: document.getElementById('googleDefaultResumeUrlSetting')
              ?.value,
            defaultCoverUrl: document.getElementById('googleDefaultCoverUrlSetting')?.value,
          });
          await getAccessToken(true);
          if (hint) {
            hint.textContent = 'Connected to Google Drive.';
            hint.className = 'muted register-settings-hint is-success';
            hint.hidden = false;
          }
          if (showStatus) showStatus('Google Drive connected.', 'success');
          updateDriveSettingsUi();
        } catch (err) {
          const msg = err.message || String(err);
          if (hint) {
            hint.textContent = msg;
            hint.className = 'muted register-settings-hint is-error';
            hint.hidden = false;
          }
          if (showStatus) showStatus(msg, 'error');
        }
      });
    }

    if (disconnectBtn) {
      disconnectBtn.addEventListener('click', async () => {
        await clearToken();
        const hint = document.getElementById('googleDriveSettingsHint');
        if (hint) {
          hint.textContent = 'Disconnected from Google Drive.';
          hint.className = 'muted register-settings-hint';
          hint.hidden = false;
        }
        updateDriveSettingsUi();
      });
    }

    updateDriveSettingsUi();
  }

  global.SmartJobGoogleDrive = {
    getDriveSettings,
    saveDriveSettings,
    isDriveConfigured,
    isDriveConnected,
    getAccessToken,
    uploadApplicationFiles,
    resolveUrlsForRegister,
    wireGoogleDriveSettings,
    updateDriveSettingsUi,
    updateRegisterDriveBadge,
    getRedirectUri,
    normalizeShareUrl,
    fileIdFromShareUrl,
    CLIENT_ID_KEY,
    FOLDER_ID_KEY,
    DEFAULT_RESUME_URL_KEY,
    DEFAULT_COVER_URL_KEY,
  };
})(typeof window !== 'undefined' ? window : self);
