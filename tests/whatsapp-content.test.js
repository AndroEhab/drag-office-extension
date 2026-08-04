const fs = require('fs');
const path = require('path');

const MAIN_SRC = fs.readFileSync(path.resolve(__dirname, '../content/wa-main.js'), 'utf-8');
const CONTENT_SRC = fs.readFileSync(path.resolve(__dirname, '../content/wa-content.js'), 'utf-8');

function loadScripts() {
  delete window.__dtsWaMainLoaded;
  eval(MAIN_SRC);
  eval(CONTENT_SRC);
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
    return `<div data-id="true_123@c.us_MSG"><div class="copyable-text">${inner}</div></div>`;
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
    expect(btn.textContent).toBe('Add to Sheets');
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

    expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
    const [msg] = chrome.runtime.sendMessage.mock.calls[0];
    expect(msg.type).toBe('wa:file');
    expect(msg.name).toBe('data.csv');
    expect(new TextDecoder().decode(new Uint8Array(msg.bytes))).toBe('x,y\n1,2');
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

    expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
    const [msg] = chrome.runtime.sendMessage.mock.calls[0];
    expect(msg.type).toBe('wa:file');
    expect(msg.name).toBe('report.xlsx');
    expect(new TextDecoder().decode(new Uint8Array(msg.bytes))).toBe('a,b\n1,2');
  });
});
