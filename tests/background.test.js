const fs = require('fs');
const path = require('path');

describe('Background service worker', () => {
  beforeAll(() => {
    jest.clearAllMocks();
    global.self = global;
    const code = fs.readFileSync(path.resolve(__dirname, '../background.js'), 'utf-8');
    eval(code);
  });

  beforeEach(() => {
    chrome.runtime.sendMessage = jest.fn().mockResolvedValue(undefined);
    chrome.storage.local.get = jest.fn().mockResolvedValue({});
    chrome.storage.local.set = jest.fn().mockResolvedValue(undefined);
    chrome.identity.getAuthToken = jest.fn().mockResolvedValue({ token: 'mock-token' });
    chrome.sidePanel.open = jest.fn().mockResolvedValue(undefined);
  });

  test('sets panel behavior to open on action click', () => {
    expect(chrome.sidePanel.setPanelBehavior).toHaveBeenCalledWith({
      openPanelOnActionClick: true,
    });
  });

  describe('WhatsApp file relay', () => {
    function encodeBase64(bytes) {
      return btoa(String.fromCharCode(...new Uint8Array(bytes)));
    }

    function getListener() {
      const calls = chrome.runtime.onMessage.addListener.mock.calls;
      return calls[calls.length - 1][0];
    }

    test('opens the side panel for the WhatsApp tab that sent the click', async () => {
      const listener = getListener();

      listener({ type: 'wa:open-panel' }, { tab: { id: 42 } });
      await Promise.resolve();

      expect(chrome.sidePanel.open).toHaveBeenCalledWith({ tabId: 42 });
    });

    test('forwards a captured WhatsApp file to the side panel when it is open', async () => {
      const listener = getListener();
      const bytes = new ArrayBuffer(7);
      new Uint8Array(bytes).set(new TextEncoder().encode('a,b\n1,2'));
      const bytesBase64 = encodeBase64(bytes);
      chrome.runtime.sendMessage.mockResolvedValue(undefined);

      listener({ type: 'wa:file', name: 'report.csv', bytesBase64, byteLength: 7 });

      await Promise.resolve();
      await Promise.resolve();

      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
        type: 'wa:file',
        name: 'report.csv',
        bytesBase64,
        byteLength: 7,
      });
    });

    test('stashes the file while the panel is closed and flushes on panel-ready', async () => {
      const listener = getListener();
      const bytes = new ArrayBuffer(4);
      new Uint8Array(bytes).set(new TextEncoder().encode('x\n1'));
      const bytesBase64 = encodeBase64(bytes);

      chrome.runtime.sendMessage
        .mockRejectedValueOnce(new Error('Receiving end does not exist.'))
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined);

      listener({ type: 'wa:file', name: 'data.xlsx', bytesBase64, byteLength: 3 });
      await Promise.resolve();
      await Promise.resolve();

      // First forward attempt failed (panel closed) — nothing more delivered yet.
      expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);

      listener({ type: 'wa:panel-ready' });
      await Promise.resolve();
      await Promise.resolve();

      // Flush delivers the stashed file, then panel-ready itself resolves.
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
        type: 'wa:file',
        name: 'data.xlsx',
        bytesBase64,
        byteLength: 3,
      });
    });

    test('ignores non-file messages', async () => {
      const listener = getListener();
      chrome.runtime.sendMessage.mockClear();

      listener({ type: 'something-else' });
      await Promise.resolve();

      expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    });
  });


});
