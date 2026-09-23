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

  function isEmbeddedExtensionFrame() {
    try {
      return (
        document.documentElement.classList.contains('assistant-dialog') ||
        /[?&]dialog=1(?:&|$)/.test(location.search || '') ||
        (location.protocol === 'chrome-extension:' && window.parent !== window)
      );
    } catch (_) {
      return false;
    }
  }

  function copyViaRuntimeTab(text) {
    return new Promise((resolve, reject) => {
      if (!chrome?.runtime?.sendMessage) {
        reject(new Error('Copy failed.'));
        return;
      }
      try {
        chrome.runtime.sendMessage({ action: 'copyTextOnActiveTab', text }, (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message || 'Copy failed.'));
            return;
          }
          if (response?.success) resolve();
          else reject(new Error(response?.error || 'Copy failed.'));
        });
      } catch (err) {
        reject(err instanceof Error ? err : new Error('Copy failed.'));
      }
    });
  }

  async function copyTextToClipboard(text) {
    const value = String(text ?? '');
    if (!value.trim()) throw new Error('Nothing to copy.');

    // Hidden logic iframe on the job page: execCommand often returns true without
    // updating the system clipboard — copy on the host tab instead.
    if (isEmbeddedExtensionFrame()) {
      try {
        await copyViaParent(value);
        return;
      } catch (_) {
        /* fall through */
      }
      try {
        await copyViaRuntimeTab(value);
        return;
      } catch (_) {
        /* fall through */
      }
    }

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

    if (!isEmbeddedExtensionFrame()) {
      try {
        await copyViaParent(value);
        return;
      } catch (_) {
        /* continue */
      }
    }

    await copyViaRuntimeTab(value);
  }

  root.copyTextToClipboard = copyTextToClipboard;

  function readTextViaParent() {
    return new Promise((resolve, reject) => {
      if (!window.parent || window.parent === window) {
        reject(new Error('Paste failed.'));
        return;
      }
      const id = 'rwh_paste_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
      const onMessage = (event) => {
        const data = event.data;
        if (
          !data ||
          data.source !== 'remote-helper-assistant' ||
          data.action !== 'pasteTextResult' ||
          data.id !== id
        ) {
          return;
        }
        window.removeEventListener('message', onMessage);
        if (data.ok) resolve(String(data.text || ''));
        else reject(new Error(data.error || 'Paste failed.'));
      };
      window.addEventListener('message', onMessage);
      try {
        window.parent.postMessage(
          {
            source: 'remote-helper-sidepanel',
            action: 'pasteText',
            id
          },
          '*'
        );
      } catch (err) {
        window.removeEventListener('message', onMessage);
        reject(err instanceof Error ? err : new Error('Paste failed.'));
        return;
      }
      setTimeout(() => {
        window.removeEventListener('message', onMessage);
        reject(new Error('Paste failed.'));
      }, 2500);
    });
  }

  async function readTextFromClipboard() {
    try {
      if (navigator.clipboard?.readText) {
        return String(await navigator.clipboard.readText());
      }
    } catch (_) {
      /* iframe / permissions — try parent bridge */
    }
    return readTextViaParent();
  }

  root.readTextFromClipboard = readTextFromClipboard;
})(typeof globalThis !== 'undefined' ? globalThis : window);
