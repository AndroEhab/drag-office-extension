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

// Realm-independent ArrayBuffer check — message payloads are structured-cloned
// across contexts, so `instanceof` can fail between realms.
const isArrayBuffer = (value) =>
  value instanceof ArrayBuffer ||
  Object.prototype.toString.call(value) === '[object ArrayBuffer]';

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== 'object') return;

  if (message.type === 'wa:file') {
    const file = {
      name: String(message.name || 'whatsapp-file'),
      bytes: message.bytes,
    };
    console.info(
      '[Drag to Sheets] SW received:',
      file.name,
      file.bytes && file.bytes.byteLength,
      'isArrayBuffer:', isArrayBuffer(file.bytes)
    );

    if (isArrayBuffer(file.bytes) && file.bytes.byteLength > 0) {
      chrome.runtime
        .sendMessage({ type: 'wa:file', name: file.name, bytes: file.bytes })
        .then(() => console.info('[Drag to Sheets] SW forwarded to panel'))
        .catch(() => {
          // No receiving end (panel closed or asleep) — hold it for later.
          pendingWhatsAppFiles.push(file);
          if (pendingWhatsAppFiles.length > MAX_STASHED_FILES) {
            pendingWhatsAppFiles.shift();
          }
          console.info('[Drag to Sheets] SW stashed, pending:', pendingWhatsAppFiles.length);
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
    if (files.length > 0) {
      console.info('[Drag to Sheets] SW flushed', files.length, 'stashed file(s)');
    }
    return;
  }
});
