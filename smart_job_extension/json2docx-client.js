/**
 * Local json2docx server connection (Settings + health).
 */
(function (global) {
  'use strict';

  const ENABLED_KEY = 'json2docx_enabled';
  const BASE_URL_KEY = 'json2docx_base_url';
  const OUTPUT_MODE_KEY = 'json2docx_output_mode';
  const DEFAULT_BASE_URL = 'http://127.0.0.1:8765';
  const DEFAULT_OUTPUT_MODE = 'docx';
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

  function setConnectionUi({ enabled, online, label }) {
    const rows = [
      {
        dot: document.getElementById('json2docxConnectionDot'),
        labelEl: document.getElementById('json2docxConnectionLabel'),
      },
      {
        dot: document.getElementById('settingsJson2docxConnectionDot'),
        labelEl: document.getElementById('settingsJson2docxConnectionLabel'),
      },
    ];

    rows.forEach(({ dot, labelEl }) => {
      if (labelEl) labelEl.textContent = label;
      if (!dot) return;
      if (!enabled) {
        dot.className = 'backend-connection-dot';
      } else if (online) {
        dot.className = 'backend-connection-dot is-ok';
      } else {
        dot.className = 'backend-connection-dot is-error';
      }
    });
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

    document.querySelectorAll('[data-tab="settings"]').forEach((tabBtn) => {
      tabBtn.addEventListener('click', () => {
        void loadJson2docxSettingsForm().then(() => checkJson2docxHealth());
      });
    });

    document.querySelectorAll('.tab-main[data-tab="register"]').forEach((tabBtn) => {
      tabBtn.addEventListener('click', () => {
        void checkJson2docxHealth();
      });
    });
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
    getLastHealth: () => ({ ...lastHealth }),
  };
})(typeof window !== 'undefined' ? window : self);
