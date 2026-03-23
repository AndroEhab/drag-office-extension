// Open side panel when extension icon is clicked
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch(console.error);

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'open-panel') return;

  try {
    const window = await chrome.windows.getCurrent();
    await chrome.sidePanel.open({ windowId: window.id });
  } catch (error) {
    console.error(error);
  }
});

chrome.runtime?.onMessage?.addListener((message) => {
  if (message?.type !== 'drag-to-sheets:perf-log') return;
  if (self.DRAG_TO_SHEETS_DEBUG_PERF !== true) return;

  console.debug(message.message, message.details || {});
});
