/**
 * In-panel confirm dialog. window.confirm is unreliable inside the on-page
 * overlay iframe (Chrome may suppress it), so destructive prompts render here.
 */
(function (root) {
  let active = null;

  function build() {
    const overlay = document.createElement('div');
    overlay.className = 'rwh-confirm';
    overlay.hidden = true;
    overlay.innerHTML = `
      <div class="rwh-confirm-sheet" role="alertdialog" aria-modal="true" aria-labelledby="rwhConfirmTitle" aria-describedby="rwhConfirmBody">
        <strong class="rwh-confirm-title" id="rwhConfirmTitle"></strong>
        <p class="rwh-confirm-body" id="rwhConfirmBody"></p>
        <div class="rwh-confirm-actions">
          <button type="button" class="btn small" data-rwh-confirm="cancel"></button>
          <button type="button" class="btn small primary" data-rwh-confirm="ok"></button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    return overlay;
  }

  /**
   * @param {string} message First line is the title; the rest is the body.
   * @returns {Promise<boolean>}
   */
  function rwhConfirm(message, { confirmLabel = 'Continue', cancelLabel = 'Cancel', danger = false } = {}) {
    if (!document.body) return Promise.resolve(false);
    if (active) active(false);

    const overlay = document.querySelector('.rwh-confirm') || build();
    const [title, ...rest] = String(message || '').split(/\n+/);
    const okBtn = overlay.querySelector('[data-rwh-confirm="ok"]');
    const cancelBtn = overlay.querySelector('[data-rwh-confirm="cancel"]');
    const body = overlay.querySelector('.rwh-confirm-body');

    overlay.querySelector('.rwh-confirm-title').textContent = title;
    body.textContent = rest.join(' ');
    body.hidden = !rest.length;
    okBtn.textContent = confirmLabel;
    cancelBtn.textContent = cancelLabel;
    okBtn.classList.toggle('danger', Boolean(danger));

    const previousFocus = document.activeElement;

    return new Promise((resolve) => {
      const close = (result) => {
        if (active !== close) return;
        active = null;
        overlay.hidden = true;
        overlay.removeEventListener('click', onClick);
        document.removeEventListener('keydown', onKey, true);
        if (previousFocus && typeof previousFocus.focus === 'function') {
          try {
            previousFocus.focus({ preventScroll: true });
          } catch (_) {
            /* ignore */
          }
        }
        resolve(result);
      };
      const onClick = (event) => {
        if (event.target === overlay) return close(false);
        const action = event.target.closest?.('[data-rwh-confirm]')?.dataset.rwhConfirm;
        if (action) close(action === 'ok');
      };
      const onKey = (event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          close(false);
        }
      };

      active = close;
      overlay.addEventListener('click', onClick);
      document.addEventListener('keydown', onKey, true);
      overlay.hidden = false;
      cancelBtn.focus();
    });
  }

  root.rwhConfirm = rwhConfirm;
})(typeof window !== 'undefined' ? window : globalThis);
