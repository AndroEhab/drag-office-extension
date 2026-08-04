/**
 * WhatsApp Web import — isolated-world content script.
 *
 * Watches the active chat for messages containing spreadsheet files
 * (csv / tsv / xlsx / xls) and renders an "Add to Sheets" button next to
 * them. Clicking the button arms the MAIN-world hooks, triggers WhatsApp's
 * own download control, captures the resulting blob, and sends the file
 * bytes to the extension (background → side panel).
 *
 * WhatsApp Web's DOM is minified and version-sensitive; all selectors are
 * ordered fallback lists so a single UI change degrades gracefully.
 */
(() => {
  'use strict';

  const EXTENSIONS = ['csv', 'tsv', 'xlsx', 'xls'];
  const MAX_FILE_BYTES = 50 * 1024 * 1024;
  const BTN_CLASS = 'dts-wa-add-btn';
  const DONE_MARK = 'data-dts-wa-added';
  const FILE_EVENT = 'dts-wa-file';
  const CLICK_EVENT = 'dts-wa-file-clicked';
  const ARM_EVENT = 'dts-wa-arm';
  const CAPTURE_TIMEOUT_MS = 12000;

  // ---- Selector fallbacks (most stable first) ----

  const CHAT_PANE_SELECTORS = [
    '[data-testid="conversation-panel-messages"]',
    '[data-testid="msg-container"]',
    '#main .copyable-area [tabindex="-1"]',
    '#main [role="application"]',
  ];

  const MESSAGE_ROOT_SELECTORS = [
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

  function isSupportedFile(name) {
    const dot = String(name || '').lastIndexOf('.');
    if (dot < 0) return false;
    return EXTENSIONS.includes(String(name).slice(dot + 1).toLowerCase());
  }

  function findFileNamesInMessage(root) {
    const names = [];
    const push = (value) => {
      const text = String(value || '').trim();
      if (text && isSupportedFile(text) && !names.includes(text)) names.push(text);
    };

    // 1. title attributes of document nodes (stable, e.g. title="report.xlsx")
    for (const node of root.querySelectorAll(DOCUMENT_NODE_SELECTORS.join(','))) {
      push(node.getAttribute('title'));
      push(node.getAttribute('aria-label'));
    }

    // 2. text content of the message bubble
    const text = root.textContent || '';
    const matches = text.match(/[\w][\w .\-()]*\.(?:csv|tsv|xlsx|xls)\b/gi);
    for (const m of matches || []) push(m);

    return names;
  }

  function findMessageRoot(node) {
    let el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    while (el && el !== document.body) {
      if (MESSAGE_ROOT_SELECTORS.some((s) => el.matches && el.matches(s))) return el;
      el = el.parentElement;
    }
    return null;
  }

  function findDownloadControl(root) {
    for (const selector of DOWNLOAD_CONTROL_SELECTORS) {
      const found = root.querySelector(selector);
      if (found) return found;
    }
    return null;
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

  function waitForCapturedBlob(btn) {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        window.removeEventListener(CLICK_EVENT, onClick);
        resolve(null);
      }, CAPTURE_TIMEOUT_MS);

      const onClick = (event) => {
        const url = (event.detail || {}).url;
        const blob = url ? capturedBlobs.get(url) : null;
        if (!blob) return;
        clearTimeout(timeout);
        window.removeEventListener(CLICK_EVENT, onClick);
        resolve(blob);
      };

      window.addEventListener(CLICK_EVENT, onClick);
    });
  }

  // ---- Scanning ----

  function scanMessage(root) {
    if (root.getAttribute && root.getAttribute(DONE_MARK)) return;
    const names = findFileNamesInMessage(root);
    if (names.length === 0) return;

    root.setAttribute(DONE_MARK, 'true');
    const fileName = names[0];
    console.info('[Drag to Sheets] found spreadsheet file:', fileName);
    const btn = createAddButton(fileName, root);

    // Place the button at the end of the message bubble.
    const placement = root.querySelector('div.copyable-text, [data-pre-plain-text], div[role="row"]');
    const target = placement || root;
    target.appendChild(btn);
  }

  function scanContainer(container) {
    for (const selector of MESSAGE_ROOT_SELECTORS) {
      for (const el of container.querySelectorAll(selector)) {
        scanMessage(el);
      }
    }
  }

  function startObserver() {
    const pane = CHAT_PANE_SELECTORS.map((s) => document.querySelector(s)).find(Boolean);
    const target = pane || document.querySelector('#main') || document.body;

    console.info('[Drag to Sheets] WhatsApp import active — observing', target === document.body ? 'body (fallback)' : 'chat pane');
    scanContainer(target);

    const observer = new MutationObserver((mutations) => {
      let scanned = false;
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          const root = findMessageRoot(node) || node;
          if (!scanned) {
            scanMessage(root);
            scanContainer(root);
            scanned = true;
          } else {
            scanMessage(root);
          }
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
