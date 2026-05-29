/**
 * Light / dark theme for the side panel.
 */
(function (global) {
  const THEME_KEY = 'extension_theme';

  function applyTheme(theme) {
    const resolved = theme === 'dark' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', resolved);
    document.documentElement.style.colorScheme = resolved;
    updateToggleUi(resolved);
  }

  function updateToggleUi(theme) {
    const btn = document.getElementById('themeToggleBtn');
    if (btn) {
      const isDark = theme === 'dark';
      btn.setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode');
      btn.setAttribute('title', isDark ? 'Light mode' : 'Dark mode');
      btn.dataset.theme = theme;
    }
    document.querySelectorAll('[data-theme-option]').forEach((el) => {
      const active = el.getAttribute('data-theme-option') === theme;
      el.classList.toggle('active', active);
      el.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  function initTheme() {
    chrome.storage.local.get([THEME_KEY], (result) => {
      const stored = result[THEME_KEY];
      if (stored === 'dark' || stored === 'light') {
        applyTheme(stored);
        return;
      }
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      applyTheme(prefersDark ? 'dark' : 'light');
    });
  }

  function setTheme(theme) {
    const resolved = theme === 'dark' ? 'dark' : 'light';
    chrome.storage.local.set({ [THEME_KEY]: resolved }, () => applyTheme(resolved));
  }

  function toggleTheme() {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    setTheme(next);
  }

  function wireThemeToggle() {
    const btn = document.getElementById('themeToggleBtn');
    if (btn) btn.addEventListener('click', toggleTheme);
  }

  function wireThemeOptions() {
    document.querySelectorAll('[data-theme-option]').forEach((btn) => {
      btn.addEventListener('click', () => {
        setTheme(btn.getAttribute('data-theme-option'));
      });
    });
  }

  // Apply before paint when possible
  if (document.documentElement) {
    chrome.storage.local.get([THEME_KEY], (result) => {
      const stored = result[THEME_KEY];
      if (stored === 'dark' || stored === 'light') {
        document.documentElement.setAttribute('data-theme', stored);
        document.documentElement.style.colorScheme = stored;
      }
    });
  }

  global.SmartJobTheme = {
    initTheme,
    toggleTheme,
    setTheme,
    applyTheme,
    wireThemeToggle,
    wireThemeOptions,
    THEME_KEY,
  };
})(typeof window !== 'undefined' ? window : self);
