/**
 * WhatsApp Web import — MAIN world hooks.
 *
 * Runs in the page's own JavaScript context (declared with "world": "MAIN")
 * so it can intercept the browser APIs WhatsApp Web uses to materialise a
 * downloaded file:
 *   - URL.createObjectURL(blob)  → every blob URL the page creates is
 *     announced to the isolated-world content script via window.postMessage
 *     (the documented cross-world channel; blobs are structured-cloneable).
 *     While an import is armed, a non-media blob is also announced directly
 *     as the file being downloaded (fallback capture).
 *   - HTMLAnchorElement.click    → downloads are only suppressed while an
 *     import is armed; a normal manual download is never touched.
 *
 * The page's own behavior is otherwise untouched.
 */
(() => {
  'use strict';

  if (window.__dtsWaMainLoaded) return;
  window.__dtsWaMainLoaded = true;

  const TAG = 'dts-wa';
  let armed = false;

  const looksLikeDocument = (blob) =>
    !/^(image|video|audio)\//.test((blob && blob.type) || '');

  // Isolated world → MAIN: arm/disarm the download capture.
  window.addEventListener('message', (event) => {
    if (event.source !== window && event.source !== null) return;
    const data = event.data;
    if (!data || data.tag !== TAG || data.dir !== 'iso') return;

    if (data.kind === 'arm') {
      armed = true;
      console.info('[Drag to Sheets] download capture armed');
      // A download that never materialises should not swallow later manual
      // downloads, so the arm expires on its own.
      setTimeout(() => { armed = false; }, 15000);
    } else if (data.kind === 'disarm') {
      armed = false;
    }
  });

  const sendToContent = (kind, payload) => {
    window.postMessage(Object.assign({ tag: TAG, dir: 'main', kind }, payload), '*');
  };

  const originalCreateObjectURL = URL.createObjectURL.bind(URL);
  URL.createObjectURL = function (blob) {
    const url = originalCreateObjectURL(blob);
    try {
      if (armed || looksLikeDocument(blob)) {
        console.info('[Drag to Sheets] blob created', blob && blob.type, blob && blob.size, 'armed:', armed);
      }
      sendToContent('file', { url, blob });
      if (armed && looksLikeDocument(blob)) {
        sendToContent('ready', { url, blob });
      }
    } catch (_) { /* best effort */ }
    return url;
  };

  const originalClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    try {
      if (
        armed &&
        typeof this.download === 'string' &&
        this.download.length > 0 &&
        typeof this.href === 'string' &&
        this.href.startsWith('blob:')
      ) {
        armed = false;
        console.info('[Drag to Sheets] suppressed native download:', this.download);
        sendToContent('clicked', { url: this.href, name: this.download });
        return; // suppress the native browser download — the extension takes the bytes
      }
      if (this.href && this.href.startsWith('blob:')) {
        console.info('[Drag to Sheets] anchor click passed through (not armed)');
      }
    } catch (_) { /* fall through to the normal click */ }
    return originalClick.call(this);
  };
})();
