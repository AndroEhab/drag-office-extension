/**
 * Drag to Sheets — background service worker.
 *
 * Responsibilities:
 *  1. Open the side panel when the toolbar action is clicked.
 *  2. Relay files captured from WhatsApp Web into the side panel. The panel
 *     may be closed when the user clicks "Add to Sheets", so files are
 *     stashed here and flushed on the next "wa:panel-ready" message.
 */

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch(() => {});

const MAX_STASHED_FILES = 5;
const pendingWhatsAppFiles = [];

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== 'object') return;

  if (message.type === 'wa:file') {
    // Message payloads are structured-cloned; the ArrayBuffer stays intact.
    const file = {
      name: String(message.name || 'whatsapp-file'),
      bytes: message.bytes,
    };

    if (message.bytes instanceof ArrayBuffer && message.bytes.byteLength > 0) {
      chrome.runtime
        .sendMessage({ type: 'wa:file', name: file.name, bytes: file.bytes })
        .catch(() => {
          // No receiving end (panel closed or asleep) — hold it for later.
          pendingWhatsAppFiles.push(file);
          if (pendingWhatsAppFiles.length > MAX_STASHED_FILES) {
            pendingWhatsAppFiles.shift();
          }
        });
    }
    return;
  }

  if (message.type === 'wa:panel-ready') {
    const files = pendingWhatsAppFiles.splice(0);
    for (const file of files) {
      chrome.runtime
        .sendMessage({ type: 'wa:file', name: file.name, bytes: file.bytes })
        .catch(() => {
          // Panel went away again — keep the file for the next readiness.
          pendingWhatsAppFiles.push(file);
        });
    }
    return;
  }
});
