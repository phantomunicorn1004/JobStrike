/**
 * Floating toast notifications (dark pill style).
 */
(function (root) {
  let hideTimer = null;

  const ICONS = {
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
    success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>',
    error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 8v5M12 16h.01"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>'
  };

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[char]));
  }

  function pickIcon(type, message) {
    const text = String(message || '').toLowerCase();
    if (/copied|clipboard/.test(text)) return ICONS.copy;
    if (type === 'error') return ICONS.error;
    if (type === 'success') return ICONS.success;
    return ICONS.info;
  }

  function getToastElement() {
    return document.getElementById('status') || document.getElementById('toast');
  }

  function hideToast(el) {
    if (!el) return;
    el.classList.remove('toast-visible');
    el.classList.add('toast-exit');
    setTimeout(() => {
      if (!el.classList.contains('toast-visible')) {
        el.classList.add('hidden');
        el.innerHTML = '';
      }
    }, 200);
  }

  function showToast(message, type = 'info', timeout = 4000) {
    const el = getToastElement();
    if (!el) return;

    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }

    const safeType = ['success', 'error', 'info'].includes(type) ? type : 'info';
    const icon = pickIcon(safeType, message);

    el.innerHTML = `
      <span class="toast-icon">${icon}</span>
      <span class="toast-message">${escapeHtml(message)}</span>`;
    el.className = `toast toast-${safeType}`;
    el.classList.remove('hidden', 'toast-exit');
    requestAnimationFrame(() => {
      el.classList.add('toast-visible');
    });

    if (timeout > 0) {
      hideTimer = setTimeout(() => {
        hideTimer = null;
        hideToast(el);
      }, timeout);
    }
  }

  root.showToast = showToast;
  root.showStatus = showToast;
})(typeof globalThis !== 'undefined' ? globalThis : window);
