/**
 * WhatsApp Web import — MAIN world hooks.
 *
 * Runs in the page's own JavaScript context (declared with "world": "MAIN")
 * so it can intercept the browser APIs WhatsApp Web uses to materialise a
 * downloaded file:
 *   - URL.createObjectURL(blob)  → every blob URL the page creates is
 *     announced to the isolated-world content script (blobs are shared DOM
 *     objects, so they can cross worlds through a CustomEvent detail).
 *   - HTMLAnchorElement.click    → downloads are only suppressed while an
 *     import is armed by the content script; a normal manual download is
 *     never touched.
 *
 * The page's own behavior is otherwise untouched.
 */
(() => {
  'use strict';

  if (window.__dtsWaMainLoaded) return;
  window.__dtsWaMainLoaded = true;

  const FILE_EVENT = 'dts-wa-file';
  const CLICK_EVENT = 'dts-wa-file-clicked';
  const ARM_EVENT = 'dts-wa-arm';

  let armed = false;

  window.addEventListener(ARM_EVENT, () => {
    armed = true;
    // A download that never materialises should not swallow later manual
    // downloads, so the arm expires on its own.
    setTimeout(() => { armed = false; }, 15000);
  });

  const originalCreateObjectURL = URL.createObjectURL.bind(URL);
  URL.createObjectURL = function (blob) {
    const url = originalCreateObjectURL(blob);
    try {
      window.dispatchEvent(new CustomEvent(FILE_EVENT, { detail: { url, blob } }));
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
        window.dispatchEvent(new CustomEvent(CLICK_EVENT, { detail: { url: this.href } }));
        return; // suppress the native browser download — the extension takes the bytes
      }
    } catch (_) { /* fall through to the normal click */ }
    return originalClick.call(this);
  };
})();
