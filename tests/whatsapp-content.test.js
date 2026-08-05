const fs = require('fs');
const path = require('path');

const MAIN_SRC = fs.readFileSync(path.resolve(__dirname, '../content/wa-main.js'), 'utf-8');
const CONTENT_SRC = fs.readFileSync(path.resolve(__dirname, '../content/wa-content.js'), 'utf-8');

function loadScripts() {
  delete window.__dtsWaMainLoaded;
  eval(MAIN_SRC);
  eval(CONTENT_SRC);
}

function decodeBase64(value) {
  const binary = atob(value);
  return new TextDecoder().decode(
    Uint8Array.from(binary, (char) => char.charCodeAt(0))
  );
}

function getFileMessages() {
  return chrome.runtime.sendMessage.mock.calls
    .map(([message]) => message)
    .filter((message) => message && message.type === 'wa:file');
}

describe('WhatsApp Web import content scripts', () => {
  beforeEach(() => {
    chrome.runtime.sendMessage.mockClear();
    chrome.runtime.sendMessage.mockResolvedValue(undefined);
    document.body.innerHTML = '';
    // jsdom gaps: no URL.createObjectURL and no Blob.arrayBuffer.
    if (typeof URL.createObjectURL !== 'function') {
      let n = 0;
      URL.createObjectURL = () => `blob:mock-${n++}`;
      URL.revokeObjectURL = () => {};
    }
    if (typeof Blob.prototype.arrayBuffer !== 'function') {
      Blob.prototype.arrayBuffer = function () {
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(reader.error || new Error('read failed'));
          reader.readAsArrayBuffer(this);
        });
      };
    }
  });

  function messageBubble(inner) {
    return `<div data-id="true_123@c.us_MSG"><div class="copyable-text"><div class="dts-wa-file-card">${inner}</div><span class="dts-wa-message-footer">8:52 PM</span></div></div>`;
  }

  function mountChat(...bubbles) {
    document.body.innerHTML = `
      <div id="main">
        <div data-testid="conversation-panel-messages">${bubbles.join('')}</div>
      </div>`;
  }

  test('adds a button next to messages with supported files', () => {
    mountChat(messageBubble('<span>report.xlsx</span>'));
    loadScripts();

    const btn = document.querySelector('.dts-wa-add-btn');
    expect(btn).not.toBeNull();
    expect(btn.querySelector('.dts-wa-logo')).not.toBeNull();
    expect(btn.getAttribute('aria-label')).toBe('Add report.xlsx to Drag to Sheets');
    expect(btn.dataset.state).toBeUndefined();
    expect(btn.disabled).toBe(false);
    expect(btn.parentElement.className).toBe('dts-wa-file-card');
  });

  test('does not add a button for unsupported files', () => {
    mountChat(messageBubble('<span>notes.pdf</span>'));
    loadScripts();

    expect(document.querySelector('.dts-wa-add-btn')).toBeNull();
  });

  test('detects filenames from document node title attributes', () => {
    document.body.innerHTML = `
      <div id="main">
        <div data-testid="conversation-panel-messages">
          <div data-id="true_1">
            <div data-testid="document-thumb" title="data.csv"></div>
          </div>
        </div>
      </div>`;
    loadScripts();

    expect(document.querySelector('.dts-wa-add-btn')).not.toBeNull();
  });

  test('does not add a button inside a quoted message', () => {
    document.body.innerHTML = `
      <div id="main">
        <div data-testid="conversation-panel-messages">
          <div data-id="outer-message">
            <div data-testid="quoted-message">
              <div data-id="quoted-message-inner">
                <span>quoted.csv</span>
              </div>
            </div>
          </div>
        </div>
      </div>`;
    loadScripts();

    expect(document.querySelector('.dts-wa-add-btn')).toBeNull();
  });

  test('restores a pending button when WhatsApp redraws the attachment card', async () => {
    mountChat(messageBubble('<span>report.xlsx</span>'));
    loadScripts();

    const card = document.querySelector('.dts-wa-file-card');
    expect(card.querySelector('.dts-wa-add-btn')).not.toBeNull();

    card.innerHTML = '<span>report.xlsx</span>';
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(card.querySelector('.dts-wa-add-btn')).not.toBeNull();
    expect(card.querySelector('.dts-wa-add-btn').dataset.state).toBeUndefined();
  });

  test('reinjects buttons when WhatsApp replaces the chat pane', async () => {
    mountChat(messageBubble('<span>report.xlsx</span>'));
    loadScripts();

    const main = document.getElementById('main');
    const newMain = document.createElement('div');
    newMain.id = 'main';
    newMain.innerHTML = '<div data-testid="conversation-panel-messages">' +
      messageBubble('<span>report.xlsx</span>') +
      '</div>';
    main.replaceWith(newMain);

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(newMain.querySelector('.dts-wa-add-btn')).not.toBeNull();
  });

  test('manual downloads are not suppressed when not armed', () => {
    mountChat(messageBubble('<span>report.xlsx</span>'));
    loadScripts();

    let intercepted = false;
    window.addEventListener('message', (event) => {
      const data = event.data;
      if (data && data.tag === 'dts-wa' && data.kind === 'clicked') intercepted = true;
    });

    const blob = new Blob(['x'], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.download = 'note.txt';
    a.href = url;
    a.click();

    expect(intercepted).toBe(false);
  });

  test('captures the blob directly when WhatsApp does not use an anchor click', async () => {
    mountChat(
      messageBubble('<span>data.csv</span><div role="button" data-icon="download"></div>')
    );
    loadScripts();

    const btn = document.querySelector('.dts-wa-add-btn');
    btn.click();
    // The arm signal travels via postMessage (async) — let it land.
    await new Promise((resolve) => setTimeout(resolve, 0));

    // WhatsApp materialises the file with just a blob URL — no anchor click.
    const blob = new Blob(['x,y\n1,2'], { type: 'text/csv' });
    blob._buffer = new TextEncoder().encode('x,y\n1,2').buffer;
    URL.createObjectURL(blob);

    await new Promise((resolve) => setTimeout(resolve, 0));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'wa:open-panel' });
    const [msg] = getFileMessages();
    expect(msg.type).toBe('wa:file');
    expect(msg.name).toBe('data.csv');
    expect(msg.bytes).toBeUndefined();
    expect(msg.bytesBase64).toEqual(expect.any(String));
    expect(msg.byteLength).toBe(7);
    expect(decodeBase64(msg.bytesBase64)).toBe('x,y\n1,2');
  });

  test('clicking the button captures WhatsApp’s blob and sends the file', async () => {
    mountChat(
      messageBubble('<span>report.xlsx</span><div role="button" data-icon="download"></div>')
    );
    loadScripts();

    const btn = document.querySelector('.dts-wa-add-btn');
    btn.click();
    // The arm signal travels via postMessage (async) — let it land.
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Simulate WhatsApp materialising the download: blob URL + anchor click.
    const blob = new Blob(['a,b\n1,2'], { type: 'text/csv' });
    blob._buffer = new TextEncoder().encode('a,b\n1,2').buffer;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.download = 'report.xlsx';
    a.href = url;
    a.click();

    await new Promise((resolve) => setTimeout(resolve, 0));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'wa:open-panel' });
    const [msg] = getFileMessages();
    expect(msg.type).toBe('wa:file');
    expect(msg.name).toBe('report.xlsx');
    expect(msg.bytes).toBeUndefined();
    expect(msg.bytesBase64).toEqual(expect.any(String));
    expect(msg.byteLength).toBe(7);
    expect(decodeBase64(msg.bytesBase64)).toBe('a,b\n1,2');
    expect(btn.isConnected).toBe(true);
    expect(btn.disabled).toBe(false);
    expect(btn.dataset.state).toBeUndefined();
    expect(btn.getAttribute('aria-label')).toBe('Add report.xlsx to Drag to Sheets');

    // A second click is allowed and sends the same file through the normal
    // pipeline, where the side panel can report it as a duplicate.
    btn.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const secondBlob = new Blob(['a,b\n1,2'], { type: 'text/csv' });
    secondBlob._buffer = new TextEncoder().encode('a,b\n1,2').buffer;
    const secondUrl = URL.createObjectURL(secondBlob);
    const secondAnchor = document.createElement('a');
    secondAnchor.download = 'report.xlsx';
    secondAnchor.href = secondUrl;
    secondAnchor.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(4);
    expect(getFileMessages()).toHaveLength(2);
  });

  test('reloads WhatsApp when Chrome invalidates the content-script context', async () => {
    mountChat(
      messageBubble('<span>report.xlsx</span><div role="button" data-icon="download"></div>')
    );
    loadScripts();

    chrome.runtime.sendMessage
      .mockResolvedValueOnce(undefined) // side-panel open request
      .mockRejectedValueOnce(new Error('Extension context invalidated.'));

    const btn = document.querySelector('.dts-wa-add-btn');
    btn.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const blob = new Blob(['a,b\n1,2'], { type: 'text/csv' });
    blob._buffer = new TextEncoder().encode('a,b\n1,2').buffer;
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.download = 'report.xlsx';
    anchor.href = url;
    anchor.click();

    await new Promise((resolve) => setTimeout(resolve, 0));
    await Promise.resolve();
    await Promise.resolve();

    expect(document.documentElement.dataset.dtsWaContextInvalidated).toBe('true');
    expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(2);
  });
});
