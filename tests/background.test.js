const fs = require('fs');
const path = require('path');

describe('Background service worker', () => {
  let commandListener;
  let messageListener;

  beforeAll(() => {
    jest.clearAllMocks();
    global.self = global;
    const code = fs.readFileSync(path.resolve(__dirname, '../background.js'), 'utf-8');
    eval(code);
    commandListener = chrome.commands.onCommand.addListener.mock.calls[0][0];
    messageListener = chrome.runtime.onMessage.addListener.mock.calls[0][0];
  });

  test('sets panel behavior to open on action click', () => {
    expect(chrome.sidePanel.setPanelBehavior).toHaveBeenCalledWith({
      openPanelOnActionClick: true,
    });
  });

  test('registers a command listener', () => {
    expect(chrome.commands.onCommand.addListener).toHaveBeenCalledTimes(1);
    expect(typeof commandListener).toBe('function');
  });

  test('registers a runtime message listener', () => {
    expect(chrome.runtime.onMessage.addListener).toHaveBeenCalledTimes(1);
    expect(typeof messageListener).toBe('function');
  });

  test('opens side panel on "open-panel" command', async () => {
    await commandListener('open-panel');

    expect(chrome.windows.getCurrent).toHaveBeenCalled();
    expect(chrome.sidePanel.open).toHaveBeenCalledWith({ windowId: 1 });
  });

  test('does not open side panel for other commands', async () => {
    chrome.sidePanel.open.mockClear();
    await commandListener('some-other-command');

    expect(chrome.sidePanel.open).not.toHaveBeenCalled();
  });

  test('logs perf messages when worker debug flag is enabled', () => {
    const originalDebug = console.debug;
    console.debug = jest.fn();
    self.DRAG_TO_SHEETS_DEBUG_PERF = true;

    try {
      messageListener({
        type: 'drag-to-sheets:perf-log',
        message: 'Drag to Sheets perf: test',
        details: { rows: 10 },
      });

      expect(console.debug).toHaveBeenCalledWith('Drag to Sheets perf: test', { rows: 10 });
    } finally {
      self.DRAG_TO_SHEETS_DEBUG_PERF = false;
      console.debug = originalDebug;
    }
  });
});
