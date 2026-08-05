/**
 * WhatsApp Web import — isolated-world content script.
 *
 * Watches the active chat for messages containing spreadsheet files
 * (csv / tsv / xlsx / xls) and renders a compact Drag to Sheets button next to
 * them. Clicking the button arms the MAIN-world hooks, triggers WhatsApp's
 * own download control, captures the resulting blob, and sends the file
 * bytes to the extension (background → side panel).
 *
 * WhatsApp Web's DOM is minified and version-sensitive, so detection is
 * anchored on the visible filename text (find the text node, walk up to the
 * message bubble) rather than on unstable class names; all attribute
 * selectors are ordered fallback lists.
 */
(() => {
  'use strict';

  const EXTENSIONS = ['csv', 'tsv', 'xlsx', 'xls'];
  // Chrome runtime messages are JSON-serialized. Base64 expands the payload
  // by roughly one third, so leave room below Chrome's 64 MiB message limit.
  const MAX_FILE_BYTES = 47 * 1024 * 1024;
  const BTN_CLASS = 'dts-wa-add-btn';
  const TAG = 'dts-wa';
  const CAPTURE_TIMEOUT_MS = 12000;

  // ---- Selector fallbacks (most stable first) ----

  const CHAT_PANE_SELECTORS = [
    '[data-testid="conversation-panel-messages"]',
    '[data-testid="msg-container"]',
    '#main .copyable-area [tabindex="-1"]',
    '#main [role="application"]',
  ];

  const BUBBLE_SELECTORS = [
    '[data-id]',
    'div.message-in',
    'div.message-out',
    '[role="row"]',
  ];

  const QUOTED_MESSAGE_SELECTORS = [
    '[data-testid*="quoted" i]',
    '[data-testid*="quote" i]',
    '[aria-label*="quoted" i]',
    '[class*="quoted" i]',
    'blockquote',
    '[role="blockquote"]',
  ];

  const DOCUMENT_NODE_SELECTORS = [
    '[data-testid*="document"]',
    '[data-icon*="document"]',
    '[aria-label*="document" i]',
    'a[href][download]',
    'div[data-testid="media-url-file-icon"]',
  ];

  const DOWNLOAD_CONTROL_SELECTORS = [
    '[data-icon="download"]',
    '[data-testid*="download"]',
    '[aria-label*="download" i]',
    '[title*="download" i]',
    'a[download]',
  ];

  const FILE_NAME_RE = /\.(?:csv|tsv|xlsx|xls)$/i;

  function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    const parts = [];
    const chunkSize = 0x6000; // avoid a huge String.fromCharCode call

    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      const chunk = bytes.subarray(offset, offset + chunkSize);
      let binary = '';
      for (let i = 0; i < chunk.length; i++) {
        binary += String.fromCharCode(chunk[i]);
      }
      parts.push(binary);
    }

    return btoa(parts.join(''));
  }

  // ---- Blob capture registry (fed by the MAIN-world hooks) ----

  const capturedBlobs = new Map(); // blob: URL -> Blob
  const activeImports = new WeakSet();
  let contextRecoveryScheduled = false;

  function isInvalidatedContextError(error) {
    return /extension context invalidated/i.test(String(error?.message || error || ''));
  }

  /**
   * A content script cannot reconnect after Chrome invalidates its extension
   * context (usually when the extension is updated or reloaded). Refreshing
   * WhatsApp is the only way to inject a live content script again. Do this
   * automatically after the first failed runtime call instead of leaving the
   * user with dead Add buttons and a cryptic console error.
   */
  function recoverInvalidatedContext(error) {
    if (!isInvalidatedContextError(error)) return false;
    if (contextRecoveryScheduled) return true;

    contextRecoveryScheduled = true;
    document.documentElement?.setAttribute('data-dts-wa-context-invalidated', 'true');
    console.warn('[Drag to Sheets] WhatsApp connection expired; reloading to reconnect.');
    setTimeout(() => {
      try {
        window.location.reload();
      } catch (_) {
        // The page may be closing or navigating already.
      }
    }, 250);
    return true;
  }

  const sendToMain = (kind) => {
    window.postMessage({ tag: TAG, dir: 'iso', kind }, '*');
  };

  function requestSidePanel() {
    try {
      Promise.resolve(chrome.runtime.sendMessage({ type: 'wa:open-panel' }))
        .catch((error) => {
          // Opening the panel is best effort; the file import can continue.
          recoverInvalidatedContext(error);
        });
    } catch (error) {
      // Runtime unavailable in test/teardown contexts.
      recoverInvalidatedContext(error);
    }
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window && event.source !== null) return;
    const data = event.data;
    if (!data || data.tag !== TAG || data.dir !== 'main') return;
    if (data.kind === 'file' && data.url && data.blob) {
      capturedBlobs.set(data.url, data.blob);
      if (capturedBlobs.size > 100) {
        const oldest = capturedBlobs.keys().next().value;
        capturedBlobs.delete(oldest);
      }
    }
  });

  // ---- Helpers ----

  function findBubble(el) {
    for (const selector of BUBBLE_SELECTORS) {
      const match = el.closest(selector);
      if (match) return match;
    }
    return el.closest('div') || el;
  }

  function isQuotedMessage(el) {
    return QUOTED_MESSAGE_SELECTORS.some((selector) => el.closest(selector));
  }

  function createAddButton(fileName, messageRoot) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = BTN_CLASS;
    const idleLabel = `Add ${fileName} to Drag to Sheets`;
    const logo = document.createElement('img');
    logo.className = 'dts-wa-logo';
    logo.alt = '';
    logo.width = 20;
    logo.height = 20;
    logo.decoding = 'async';
    logo.src = chrome.runtime.getURL('images/icon-48.png');
    logo.addEventListener('error', () => {
      // Keep the control usable if a browser refuses the extension resource.
      logo.remove();
      btn.classList.add('dts-wa-logo-missing');
    }, { once: true });
    btn.appendChild(logo);
    btn.setAttribute('aria-label', idleLabel);
    btn.title = idleLabel;

    btn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      requestSidePanel();
      if (activeImports.has(btn)) return;
      activeImports.add(btn);
      void importFile(fileName, messageRoot)
        .finally(() => activeImports.delete(btn));
    });

    return btn;
  }

  async function importFile(fileName, messageRoot) {
    try {
      // Arm the MAIN-world hooks, then trigger WhatsApp's own download.
      sendToMain('arm');

      const control = findDownloadControl(messageRoot);
      if (control) {
        control.click();
      } else {
        // No direct download control — opening the document bubble reveals
        // the preview modal with a Download button; keep watching for it.
        const mediaNode = messageRoot.querySelector(DOCUMENT_NODE_SELECTORS.join(',')) || messageRoot;
        mediaNode.click();
      }

      const blob = await waitForCapturedBlob();
      if (!blob) {
        console.warn('[Drag to Sheets] no spreadsheet download found:', fileName);
        return;
      }

      if (blob.size > MAX_FILE_BYTES) {
        console.warn('[Drag to Sheets] spreadsheet is too large:', fileName, blob.size);
        return;
      }

      const bytes = await blob.arrayBuffer();
      const bytesBase64 = arrayBufferToBase64(bytes);
      await chrome.runtime.sendMessage({
        type: 'wa:file',
        name: fileName,
        bytesBase64,
        byteLength: bytes.byteLength,
      });
      console.info('[Drag to Sheets] sent file to extension:', fileName, bytes.byteLength);
    } catch (err) {
      if (!recoverInvalidatedContext(err)) {
        console.error('[Drag to Sheets] import failed:', err);
      }
    }
  }

  function findDownloadControl(root) {
    for (const selector of DOWNLOAD_CONTROL_SELECTORS) {
      const found = root.querySelector(selector);
      if (found) return found;
    }
    return null;
  }

  function waitForCapturedBlob() {
    return new Promise((resolve) => {
      let settled = false;

      const finish = (blob) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        window.removeEventListener('message', onMessage);
        // Let any pending native anchor click still be suppressed, then disarm.
        setTimeout(() => sendToMain('disarm'), 800);
        resolve(blob);
      };

      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        window.removeEventListener('message', onMessage);
        resolve(null);
      }, CAPTURE_TIMEOUT_MS);

      const onMessage = (event) => {
        if (event.source !== window && event.source !== null) return;
        const data = event.data;
        if (!data || data.tag !== TAG || data.dir !== 'main') return;

        if (data.kind === 'clicked') {
          const blob = data.url ? capturedBlobs.get(data.url) : null;
          if (blob) {
            console.info('[Drag to Sheets] captured via anchor click', blob.size);
            finish(blob);
          }
        } else if (data.kind === 'ready' && data.blob) {
          console.info('[Drag to Sheets] captured via armed blob', data.blob.size);
          finish(data.blob);
        }
      };

      window.addEventListener('message', onMessage);
    });
  }

  // ---- Scanning (anchored on the visible filename text) ----

  function attachToBubble(el, fileName) {
    if (isQuotedMessage(el)) return;
    const bubble = findBubble(el);
    if (!bubble || bubble.querySelector(`.${BTN_CLASS}`)) return;

    console.info('[Drag to Sheets] found spreadsheet file:', fileName);

    const btn = createAddButton(fileName, bubble);
    const parent = el.parentElement;
    if (parent && bubble.contains(parent)) {
      // The broad copyable-text/row containers can span the whole viewport.
      // Insert beside the filename's own element so the action stays with the
      // attachment card instead of floating at the left edge of the chat.
      parent.insertBefore(btn, el.nextSibling);
    } else {
      bubble.appendChild(btn);
    }
  }

  function scanFileMessages(container) {
    const checkLeaf = (el) => {
      if (el.childElementCount > 0) return;
      const text = (el.textContent || '').trim();
      if (!text || text.length > 200) return;
      if (FILE_NAME_RE.test(text)) {
        attachToBubble(el, text);
        return;
      }
      // Diagnostics: a supported filename appears mid-text (e.g. followed by
      // the file size) — WhatsApp changed how the name is rendered.
      if (/(?:^|\s)[\w][\w .\-()]*\.(?:csv|tsv|xlsx|xls)(?=\s|$)/i.test(text)) {
        console.info('[Drag to Sheets] filename embedded in text:', JSON.stringify(text.slice(0, 120)));
      }
    };

    // Pass 1: text leaves that display a supported filename.
    for (const el of container.querySelectorAll('div, span')) {
      checkLeaf(el);
    }
    if (container.matches && container.matches('div, span')) checkLeaf(container);

    // Pass 2: document nodes carrying the name in title/aria-label.
    for (const el of container.querySelectorAll(DOCUMENT_NODE_SELECTORS.join(','))) {
      const name = (el.getAttribute('title') || el.getAttribute('aria-label') || '').trim();
      if (!name || !FILE_NAME_RE.test(name)) continue;
      attachToBubble(el, name);
    }
  }

  function startObserver() {
    const pane = CHAT_PANE_SELECTORS.map((s) => document.querySelector(s)).find(Boolean);
    // Observe the stable document body rather than #main/current chat pane.
    // WhatsApp can replace both of those inner containers when navigating.
    const target = document.body || document.documentElement;

    console.info(
      '[Drag to Sheets] WhatsApp import active — observing',
      pane ? 'stable body' : 'stable body (chat pane pending)'
    );
    scanFileMessages(target);

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        const removedButton = Array.from(mutation.removedNodes).some((node) =>
          node.nodeType === Node.ELEMENT_NODE &&
          (node.matches(`.${BTN_CLASS}`) || node.querySelector(`.${BTN_CLASS}`))
        );
        if (removedButton && mutation.target.nodeType === Node.ELEMENT_NODE) {
          // WhatsApp can replace an entire attachment subtree. Rescan the
          // surviving parent so the button is restored beside the filename.
          scanFileMessages(mutation.target);
        }

        for (const node of mutation.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          scanFileMessages(node);
        }
      }
    });

    observer.observe(target, { childList: true, subtree: true });
  }

  // The chat pane is rendered after WhatsApp boots — retry until it exists.
  let attempts = 0;
  const tryStart = () => {
    const pane = CHAT_PANE_SELECTORS.map((s) => document.querySelector(s)).find(Boolean);
    if (pane || attempts > 20) {
      startObserver();
      return;
    }
    attempts++;
    setTimeout(tryStart, 500);
  };
  tryStart();
})();
