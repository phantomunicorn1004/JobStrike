/**
 * Local json2docx server connection (Settings + health).
 */
(function (global) {
  'use strict';

  const ENABLED_KEY = 'json2docx_enabled';
  const BASE_URL_KEY = 'json2docx_base_url';
  const OUTPUT_MODE_KEY = 'json2docx_output_mode';
  const DEFAULT_BASE_URL = 'http://127.0.0.1:8765';
  const DEFAULT_OUTPUT_MODE = 'both';
  const OUTPUT_MODES = ['docx', 'pdf', 'both'];

  let lastHealth = {
    ok: false,
    checked: false,
    error: '',
    version: '',
    templates: null,
  };

  function trim(value) {
    return String(value == null ? '' : value).trim();
  }

  function normalizeBaseUrl(value) {
    let url = trim(value) || DEFAULT_BASE_URL;
    url = url.replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(url)) {
      url = `http://${url}`;
    }
    return url;
  }

  function normalizeOutputMode(value) {
    const mode = trim(value).toLowerCase();
    return OUTPUT_MODES.includes(mode) ? mode : DEFAULT_OUTPUT_MODE;
  }

  function storageGet(keys) {
    return new Promise((resolve) => {
      chrome.storage.local.get(keys, (result) => resolve(result || {}));
    });
  }

  function storageSet(values) {
    return new Promise((resolve) => {
      chrome.storage.local.set(values, resolve);
    });
  }

  async function getJson2docxConfig() {
    const result = await storageGet([ENABLED_KEY, BASE_URL_KEY, OUTPUT_MODE_KEY]);
    const rawEnabled = result[ENABLED_KEY];
    const enabled = rawEnabled === true || rawEnabled === 'true';
    return {
      enabled,
      baseUrl: normalizeBaseUrl(result[BASE_URL_KEY]),
      outputMode: normalizeOutputMode(result[OUTPUT_MODE_KEY]),
    };
  }

  async function saveJson2docxConfig({ enabled, baseUrl, outputMode }) {
    await storageSet({
      [ENABLED_KEY]: Boolean(enabled),
      [BASE_URL_KEY]: normalizeBaseUrl(baseUrl),
      [OUTPUT_MODE_KEY]: normalizeOutputMode(outputMode),
    });
    return getJson2docxConfig();
  }

  function apiUrl(baseUrl, path) {
    const root = normalizeBaseUrl(baseUrl);
    const suffix = path.startsWith('/') ? path : `/${path}`;
    return `${root}${suffix}`;
  }

  async function fetchHealth(baseUrl, { timeoutMs = 2500 } = {}) {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller
      ? setTimeout(() => controller.abort(), timeoutMs)
      : null;
    try {
      const response = await fetch(apiUrl(baseUrl, '/health'), {
        method: 'GET',
        signal: controller?.signal,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.ok) {
        throw new Error(data?.error || `Health check failed (${response.status})`);
      }
      return {
        ok: true,
        version: data.version || '',
        downloads: data.downloads || '',
        raw: data,
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  function pickPreferredGeneratedFiles(files, _outputMode) {
    const list = Array.isArray(files) ? files : [];

    // Register auto-attach always uses DOCX (PDFs may still be generated/downloaded).
    function pickKind(kind) {
      const matches = list.filter((f) => f && f.kind === kind && f.file);
      if (!matches.length) return null;
      return (
        matches.find((f) => String(f.format || '').toLowerCase() === 'docx') ||
        matches.find((f) => String(f.filename || f.file?.name || '').toLowerCase().endsWith('.docx')) ||
        null
      );
    }

    return {
      resume: pickKind('resume'),
      coverLetter: pickKind('cover_letter'),
    };
  }

  async function downloadGeneratedFile(baseUrl, fileInfo, { timeoutMs = 60000 } = {}) {
    const params = new URLSearchParams();
    if (fileInfo?.path) params.set('path', fileInfo.path);
    else if (fileInfo?.filename) params.set('filename', fileInfo.filename);
    else throw new Error('Missing download path/filename');

    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const response = await fetch(`${apiUrl(baseUrl, '/download')}?${params.toString()}`, {
        method: 'GET',
        signal: controller?.signal,
      });
      if (!response.ok) {
        let message = `Download failed (${response.status})`;
        try {
          const errBody = await response.json();
          if (errBody?.error) message = errBody.error;
        } catch (_) {
          // ignore
        }
        throw new Error(message);
      }
      const blob = await response.blob();
      const filename = fileInfo.filename || 'download.docx';
      const type =
        blob.type ||
        (String(filename).toLowerCase().endsWith('.pdf')
          ? 'application/pdf'
          : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      const file = new File([blob], filename, { type });
      return {
        kind: fileInfo.kind || 'resume',
        format: fileInfo.format || '',
        path: fileInfo.path || '',
        filename,
        file,
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * POST /generate then download each returned file as a File object.
   * @param {object|string} resumeJson
   * @param {{ outputMode?: string, onProgress?: Function }} [options]
   */
  async function generateAndDownloadFiles(resumeJson, options = {}) {
    const config = await getJson2docxConfig();
    if (!config.enabled) {
      throw new Error('Enable local json2docx in Settings first.');
    }

    const outputMode = normalizeOutputMode(options.outputMode || config.outputMode);
    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
    const baseUrl = config.baseUrl;

    onProgress?.({ stage: 'health', percent: 5, message: 'Checking json2docx server…' });
    await fetchHealth(baseUrl, { timeoutMs: 3000 });

    onProgress?.({ stage: 'generate', percent: 20, message: 'Converting resume JSON…' });
    const generateController =
      typeof AbortController !== 'undefined' ? new AbortController() : null;
    const generateTimer = generateController
      ? setTimeout(() => generateController.abort(), options.generateTimeoutMs || 180000)
      : null;

    let generatePayload;
    try {
      const response = await fetch(apiUrl(baseUrl, '/generate'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          json: resumeJson,
          output_mode: outputMode,
        }),
        signal: generateController?.signal,
      });
      generatePayload = await response.json().catch(() => ({}));
      if (!response.ok || !generatePayload?.ok) {
        throw new Error(
          generatePayload?.error || `Generate failed (${response.status})`
        );
      }
    } catch (err) {
      if (err?.name === 'AbortError') {
        throw new Error('Generate timed out. Check the json2docx server console.');
      }
      throw err;
    } finally {
      if (generateTimer) clearTimeout(generateTimer);
    }

    const remoteFiles = Array.isArray(generatePayload.files) ? generatePayload.files : [];
    if (!remoteFiles.length) {
      throw new Error('Generate succeeded but returned no files.');
    }

    const downloaded = [];
    for (let i = 0; i < remoteFiles.length; i += 1) {
      const info = remoteFiles[i];
      const percent = 40 + Math.round(((i + 1) / remoteFiles.length) * 55);
      onProgress?.({
        stage: 'download',
        percent,
        message: `Downloading ${info.filename || info.kind || 'file'}…`,
      });
      downloaded.push(await downloadGeneratedFile(baseUrl, info));
    }

    const preferred = pickPreferredGeneratedFiles(downloaded, outputMode);
    onProgress?.({ stage: 'done', percent: 100, message: 'Files ready.' });

    return {
      ok: true,
      template: generatePayload.template || '',
      outputMode,
      files: downloaded,
      preferred,
      downloads: generatePayload.downloads || '',
    };
  }

  function setConnectionUi({ enabled, online, label }) {
    const headerChip = document.getElementById('rbChipJson2docx');
    const headerDot = document.getElementById('json2docxConnectionDot');
    const headerLabel = document.getElementById('json2docxConnectionLabel');
    const settingsDot = document.getElementById('settingsJson2docxConnectionDot');
    const settingsLabel = document.getElementById('settingsJson2docxConnectionLabel');

    if (headerLabel) headerLabel.textContent = 'Json2Docx';
    if (headerChip) headerChip.title = label || 'Local json2docx server';
    if (settingsLabel) settingsLabel.textContent = label;

    const applyDot = (dot) => {
      if (!dot) return;
      if (!enabled) {
        dot.className = 'backend-connection-dot';
      } else if (online) {
        dot.className = 'backend-connection-dot is-ok';
      } else {
        dot.className = 'backend-connection-dot is-error';
      }
    };
    applyDot(headerDot);
    applyDot(settingsDot);

    try {
      document.dispatchEvent(new CustomEvent('rwh-json2docx-ui'));
    } catch (_) {
      /* ignore */
    }
  }

  async function checkJson2docxHealth({ updateUi = true } = {}) {
    const config = await getJson2docxConfig();
    if (!config.enabled) {
      lastHealth = {
        ok: false,
        checked: true,
        error: 'disabled',
        version: '',
        templates: null,
      };
      if (updateUi) {
        setConnectionUi({
          enabled: false,
          online: false,
          label: 'json2docx disabled',
        });
      }
      return { ...lastHealth, config };
    }

    try {
      const health = await fetchHealth(config.baseUrl);
      lastHealth = {
        ok: true,
        checked: true,
        error: '',
        version: health.version || '',
        templates: null,
      };
      if (updateUi) {
        const ver = health.version ? ` v${health.version}` : '';
        setConnectionUi({
          enabled: true,
          online: true,
          label: `json2docx connected${ver}`,
        });
      }
      return { ...lastHealth, config, health };
    } catch (err) {
      const message = err?.name === 'AbortError'
        ? 'Timed out'
        : err?.message || String(err);
      lastHealth = {
        ok: false,
        checked: true,
        error: message,
        version: '',
        templates: null,
      };
      if (updateUi) {
        setConnectionUi({
          enabled: true,
          online: false,
          label: `json2docx offline (${message})`,
        });
      }
      return { ...lastHealth, config };
    }
  }

  function setSettingsHint(message, type) {
    const el = document.getElementById('json2docxSettingsHint');
    if (!el) return;
    el.textContent = message || '';
    el.className = 'muted register-settings-hint' + (type ? ` is-${type}` : '');
    el.hidden = !message;
  }

  async function loadJson2docxSettingsForm() {
    const config = await getJson2docxConfig();
    const enabledEl = document.getElementById('json2docxEnabledSetting');
    const urlEl = document.getElementById('json2docxBaseUrlSetting');
    const modeEl = document.getElementById('json2docxOutputModeSetting');
    if (enabledEl) enabledEl.checked = Boolean(config.enabled);
    if (urlEl) urlEl.value = config.baseUrl;
    if (modeEl) modeEl.value = config.outputMode;
    return config;
  }

  async function saveJson2docxSettingsFromForm() {
    const enabled = Boolean(document.getElementById('json2docxEnabledSetting')?.checked);
    const baseUrl = document.getElementById('json2docxBaseUrlSetting')?.value;
    const outputMode = document.getElementById('json2docxOutputModeSetting')?.value;
    return saveJson2docxConfig({ enabled, baseUrl, outputMode });
  }

  function wireJson2docxSettings(showStatus) {
    const form = document.getElementById('json2docxSettingsForm');
    const testBtn = document.getElementById('testJson2docxConnectionBtn');
    if (!form) return;

    void loadJson2docxSettingsForm().then(() => checkJson2docxHealth());

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        setSettingsHint('Saving…', '');
        const config = await saveJson2docxSettingsFromForm();
        setSettingsHint('Saved json2docx settings.', 'success');
        if (showStatus) showStatus('json2docx settings saved.', 'success');
        await checkJson2docxHealth();
        if (config.enabled && !lastHealth.ok && showStatus) {
          showStatus(`json2docx offline: ${lastHealth.error || 'unreachable'}`, 'error');
        }
      } catch (err) {
        const msg = err.message || String(err);
        setSettingsHint(msg, 'error');
        if (showStatus) showStatus(msg, 'error');
      }
    });

    if (testBtn) {
      testBtn.addEventListener('click', async () => {
        try {
          await saveJson2docxSettingsFromForm();
          setSettingsHint('Testing json2docx…', '');
          const result = await checkJson2docxHealth();
          if (!result.config.enabled) {
            setSettingsHint('Enable json2docx first, then test.', 'error');
            return;
          }
          if (result.ok) {
            setSettingsHint(
              `Connected${result.version ? ` (v${result.version})` : ''}.`,
              'success'
            );
            if (showStatus) showStatus('json2docx connection OK.', 'success');
          } else {
            setSettingsHint(result.error || 'Connection failed.', 'error');
            if (showStatus) showStatus(`json2docx offline: ${result.error}`, 'error');
          }
        } catch (err) {
          const msg = err.message || String(err);
          setSettingsHint(msg, 'error');
          if (showStatus) showStatus(msg, 'error');
        }
      });
    }

    const headerSettings = document.getElementById('headerSettingsBtn');
    if (headerSettings) {
      headerSettings.addEventListener('click', () => {
        const settingsOpen = document.getElementById('tab-settings')?.classList.contains('active');
        if (settingsOpen) {
          void loadJson2docxSettingsForm().then(() => checkJson2docxHealth());
        } else {
          void checkJson2docxHealth();
        }
      });
    }
  }

  function initJson2docxClient(showStatus) {
    wireJson2docxSettings(showStatus);
    void checkJson2docxHealth();
  }

  global.SmartJobJson2Docx = {
    ENABLED_KEY,
    BASE_URL_KEY,
    OUTPUT_MODE_KEY,
    DEFAULT_BASE_URL,
    DEFAULT_OUTPUT_MODE,
    OUTPUT_MODES,
    normalizeBaseUrl,
    normalizeOutputMode,
    apiUrl,
    getJson2docxConfig,
    saveJson2docxConfig,
    fetchHealth,
    checkJson2docxHealth,
    loadJson2docxSettingsForm,
    initJson2docxClient,
    pickPreferredGeneratedFiles,
    downloadGeneratedFile,
    generateAndDownloadFiles,
    getLastHealth: () => ({ ...lastHealth }),
  };
})(typeof window !== 'undefined' ? window : self);
