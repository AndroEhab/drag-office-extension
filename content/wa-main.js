/**
 * WhatsApp Web import — MAIN world hooks.
 *
 * Runs in the page's own JavaScript context (declared with "world": "MAIN")
 * so it can intercept the browser APIs WhatsApp Web uses to materialise a
 * downloaded file:
 *   - URL.createObjectURL(blob)  → every blob URL the page creates is
 *     announced to the isolated-world content script (blobs are shared DOM
 *     objects, so they can cross worlds through a CustomEvent detail).
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

  const FILE_EVENT = 'dts-wa-file';
  const READY_EVENT = 'dts-wa-file-ready';
  const CLICK_EVENT = 'dts-wa-file-clicked';
  const ARM_EVENT = 'dts-wa-arm';
  const DISARM_EVENT = 'dts-wa-disarm';

  let armed = false;

  window.addEventListener(ARM_EVENT, () => {
    armed = true;
    console.info('[Drag to Sheets] download capture armed');
    // A download that never materialises should not swallow later manual
    // downloads, so the arm expires on its own.
    setTimeout(() => { armed = false; }, 15000);
  });

  window.addEventListener(DISARM_EVENT, () => {
    armed = false;
  });

  const looksLikeDocument = (blob) =>
    !/^(image|video|audio)\//.test((blob && blob.type) || '');

  const originalCreateObjectURL = URL.createObjectURL.bind(URL);
  URL.createObjectURL = function (blob) {
    const url = originalCreateObjectURL(blob);
    try {
      if (armed || looksLikeDocument(blob)) {
        console.info('[Drag to Sheets] blob created', blob && blob.type, blob && blob.size, 'armed:', armed);
      }
      window.dispatchEvent(new CustomEvent(FILE_EVENT, { detail: { url, blob } }));
      if (armed && looksLikeDocument(blob)) {
        window.dispatchEvent(new CustomEvent(READY_EVENT, { detail: { url, blob } }));
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
        window.dispatchEvent(new CustomEvent(CLICK_EVENT, {
          detail: { url: this.href, name: this.download },
        }));
        return; // suppress the native browser download — the extension takes the bytes
      }
      if (this.href && this.href.startsWith('blob:')) {
        console.info('[Drag to Sheets] anchor click passed through (not armed)');
      }
    } catch (_) { /* fall through to the normal click */ }
    return originalClick.call(this);
  };
})();
