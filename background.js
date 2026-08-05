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

// Keep accepting ArrayBuffers for browser/test compatibility, but the normal
// Chrome transport is the JSON-safe `bytesBase64` field.
const isArrayBuffer = (value) =>
  value instanceof ArrayBuffer ||
  Object.prototype.toString.call(value) === '[object ArrayBuffer]';

const arrayBufferToBase64 = (buffer) => {
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
};

const getTransportFile = (message) => {
  let bytesBase64 = typeof message.bytesBase64 === 'string'
    ? message.bytesBase64
    : '';

  // Preserve compatibility with structured-clone browsers and older callers;
  // Chrome content scripts use bytesBase64 because runtime messaging is JSON.
  if (!bytesBase64 && isArrayBuffer(message.bytes)) {
    bytesBase64 = arrayBufferToBase64(message.bytes);
  }

  if (!bytesBase64) return null;

  return {
    name: String(message.name || 'whatsapp-file'),
    bytesBase64,
    byteLength: Number(message.byteLength) || 0,
  };
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== 'object') return;

  if (message.type === 'wa:open-panel') {
    const tabId = sender?.tab?.id;
    if (!Number.isInteger(tabId)) {
      sendResponse?.({ accepted: false });
      return;
    }

    chrome.sidePanel
      .open({ tabId })
      .then(() => console.info('[Drag to Sheets] side panel opened for tab:', tabId))
      .catch((error) => console.warn('[Drag to Sheets] could not open side panel:', error));
    sendResponse?.({ accepted: true });
    return;
  }

  if (message.type === 'wa:file') {
    const file = getTransportFile(message);
    if (!file) {
      sendResponse?.({ accepted: false });
      return;
    }

    console.info(
      '[Drag to Sheets] SW received:',
      file.name,
      file.byteLength || '(encoded)',
      'base64:', file.bytesBase64.length
    );

    if (file.bytesBase64.length > 0) {
      chrome.runtime
        .sendMessage({
          type: 'wa:file',
          name: file.name,
          bytesBase64: file.bytesBase64,
          byteLength: file.byteLength,
        })
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
    sendResponse?.({ accepted: true });
    return;
  }

  if (message.type === 'wa:panel-ready') {
    const files = pendingWhatsAppFiles.splice(0);
    for (const file of files) {
      chrome.runtime
        .sendMessage({
          type: 'wa:file',
          name: file.name,
          bytesBase64: file.bytesBase64,
          byteLength: file.byteLength,
        })
        .catch(() => {
          // Panel went away again — keep the file for the next readiness.
          pendingWhatsAppFiles.push(file);
        });
    }
    sendResponse?.({ accepted: true });
    if (files.length > 0) {
      console.info('[Drag to Sheets] SW flushed', files.length, 'stashed file(s)');
    }
    return;
  }
});
