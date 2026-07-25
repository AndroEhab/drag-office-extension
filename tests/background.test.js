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


});
