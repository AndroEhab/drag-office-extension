/**
 * WhatsApp Web import — isolated-world content script.
 *
 * Watches the active chat for messages containing spreadsheet files
 * (csv / tsv / xlsx / xls) and renders an "Add to Sheets" button next to
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
  const MAX_FILE_BYTES = 50 * 1024 * 1024;
  const BTN_CLASS = 'dts-wa-add-btn';
  const DONE_MARK = 'data-dts-wa-added';
  const FILE_EVENT = 'dts-wa-file';
  const READY_EVENT = 'dts-wa-file-ready';
  const CLICK_EVENT = 'dts-wa-file-clicked';
  const ARM_EVENT = 'dts-wa-arm';
  const DISARM_EVENT = 'dts-wa-disarm';
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

  // ---- Blob capture registry (fed by the MAIN-world hooks) ----

  const capturedBlobs = new Map(); // blob: URL -> Blob

  window.addEventListener(FILE_EVENT, (event) => {
    const detail = event.detail || {};
    if (detail.url && detail.blob) {
      capturedBlobs.set(detail.url, detail.blob);
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

  function createAddButton(fileName, messageRoot) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = BTN_CLASS;
    btn.textContent = 'Add to Sheets';
    btn.title = `Add ${fileName} to Drag to Sheets`;

    btn.addEventListener('click', () => {
      btn.disabled = true;
      btn.textContent = 'Adding…';
      void importFile(fileName, messageRoot, btn);
    });

    return btn;
  }

  async function importFile(fileName, messageRoot, btn) {
    const reset = () => {
      btn.disabled = false;
      btn.textContent = 'Add to Sheets';
    };

    try {
      // Arm the MAIN-world hooks, then trigger WhatsApp's own download.
      window.dispatchEvent(new CustomEvent(ARM_EVENT));

      const control = findDownloadControl(messageRoot);
      if (control) {
        control.click();
      } else {
        // No direct download control — opening the document bubble reveals
        // the preview modal with a Download button; keep watching for it.
        const mediaNode = messageRoot.querySelector(DOCUMENT_NODE_SELECTORS.join(',')) || messageRoot;
        mediaNode.click();
      }

      const blob = await waitForCapturedBlob(btn);
      if (!blob) {
        btn.textContent = 'No download found';
        setTimeout(reset, 2000);
        return;
      }

      if (blob.size > MAX_FILE_BYTES) {
        btn.textContent = 'File too large';
        setTimeout(reset, 2000);
        return;
      }

      const bytes = await blob.arrayBuffer();
      await chrome.runtime.sendMessage({
        type: 'wa:file',
        name: fileName,
        bytes,
      });
      btn.textContent = 'Added!';
      setTimeout(() => btn.remove(), 1500);
    } catch (err) {
      btn.textContent = 'Failed';
      setTimeout(reset, 2000);
    }
  }

  function findDownloadControl(root) {
    for (const selector of DOWNLOAD_CONTROL_SELECTORS) {
      const found = root.querySelector(selector);
      if (found) return found;
    }
    return null;
  }

  function waitForCapturedBlob(btn) {
    return new Promise((resolve) => {
      let settled = false;

      const finish = (blob) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        window.removeEventListener(CLICK_EVENT, onClick);
        window.removeEventListener(READY_EVENT, onReady);
        // Let any pending native anchor click still be suppressed, then disarm.
        setTimeout(() => window.dispatchEvent(new CustomEvent(DISARM_EVENT)), 800);
        resolve(blob);
      };

      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        window.removeEventListener(CLICK_EVENT, onClick);
        window.removeEventListener(READY_EVENT, onReady);
        resolve(null);
      }, CAPTURE_TIMEOUT_MS);

      const onClick = (event) => {
        const detail = event.detail || {};
        const url = detail.url;
        const blob = url ? capturedBlobs.get(url) : null;
        if (blob) finish(blob);
      };

      const onReady = (event) => {
        const blob = (event.detail || {}).blob;
        if (blob) finish(blob);
      };

      window.addEventListener(CLICK_EVENT, onClick);
      window.addEventListener(READY_EVENT, onReady);
    });
  }

  // ---- Scanning (anchored on the visible filename text) ----

  function attachToBubble(el, fileName) {
    const bubble = findBubble(el);
    if (!bubble || bubble.getAttribute && bubble.getAttribute(DONE_MARK)) return;

    bubble.setAttribute(DONE_MARK, 'true');
    console.info('[Drag to Sheets] found spreadsheet file:', fileName);

    const btn = createAddButton(fileName, bubble);
    const placement = bubble.querySelector('div.copyable-text, [data-pre-plain-text], div[role="row"]');
    (placement || bubble).appendChild(btn);
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
    const target = pane || document.querySelector('#main') || document.body;

    console.info(
      '[Drag to Sheets] WhatsApp import active — observing',
      target === document.body ? 'body (fallback)' : 'chat pane'
    );
    scanFileMessages(target);

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
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
