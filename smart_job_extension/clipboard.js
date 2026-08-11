/**
 * Clipboard helper that works in side panel and dialog iframe.
 * Chrome blocks Clipboard API in extension iframes (permissions policy).
 */
(function (root) {
  function copyViaExecCommand(text) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    try {
      if (!document.execCommand('copy')) {
        throw new Error('Copy failed.');
      }
    } finally {
      textarea.remove();
    }
  }

  function copyViaParent(text) {
    return new Promise((resolve, reject) => {
      if (!window.parent || window.parent === window) {
        reject(new Error('Copy failed.'));
        return;
      }
      const id = 'rwh_copy_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
      const onMessage = (event) => {
        const data = event.data;
        if (
          !data ||
          data.source !== 'remote-helper-assistant' ||
          data.action !== 'copyTextResult' ||
          data.id !== id
        ) {
          return;
        }
        window.removeEventListener('message', onMessage);
        if (data.ok) resolve();
        else reject(new Error(data.error || 'Copy failed.'));
      };
      window.addEventListener('message', onMessage);
      try {
        window.parent.postMessage(
          {
            source: 'remote-helper-sidepanel',
            action: 'copyText',
            id,
            text
          },
          '*'
        );
      } catch (err) {
        window.removeEventListener('message', onMessage);
        reject(err instanceof Error ? err : new Error('Copy failed.'));
        return;
      }
      setTimeout(() => {
        window.removeEventListener('message', onMessage);
        reject(new Error('Copy failed.'));
      }, 2500);
    });
  }

  async function copyTextToClipboard(text) {
    const value = String(text ?? '');
    if (!value.trim()) throw new Error('Nothing to copy.');

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        return;
      }
    } catch (_) {
      /* Permissions policy / iframe blocks Clipboard API — try fallbacks. */
    }

    try {
      copyViaExecCommand(value);
      return;
    } catch (_) {
      /* continue */
    }

    await copyViaParent(value);
  }

  root.copyTextToClipboard = copyTextToClipboard;
})(typeof globalThis !== 'undefined' ? globalThis : window);
