// Polyfill TextDecoder/TextEncoder for jest-environment-jsdom (not included by default)
const { TextDecoder, TextEncoder } = require('util');
global.TextDecoder = global.TextDecoder || TextDecoder;
global.TextEncoder = global.TextEncoder || TextEncoder;

// Chrome Extension API mocks
global.chrome = {
  sidePanel: {
    setPanelBehavior: jest.fn().mockResolvedValue(undefined),
    open: jest.fn().mockResolvedValue(undefined),
  },
  commands: {
    onCommand: {
      addListener: jest.fn(),
    },
  },
  windows: {
    getCurrent: jest.fn().mockResolvedValue({ id: 1 }),
  },
  runtime: {
    sendMessage: jest.fn().mockResolvedValue(undefined),
    getURL: jest.fn((path) => path),
    onMessage: {
      addListener: jest.fn(),
    },
  },
  identity: {
    getAuthToken: jest.fn().mockResolvedValue({ token: 'mock-token' }),
    removeCachedAuthToken: jest.fn().mockResolvedValue(undefined),
  },
  storage: {
    session: {
      get: jest.fn().mockResolvedValue({}),
      set: jest.fn().mockResolvedValue(undefined),
    },
    local: {
      get: jest.fn().mockResolvedValue({}),
      set: jest.fn().mockResolvedValue(undefined),
    },
  },
  tabs: {
    create: jest.fn().mockResolvedValue({}),
  },
};

// CSS.escape for sidepanel.js session restore
global.CSS = {
  escape: jest.fn((str) => str),
};

// Mock FileReader — uses _content / _buffer properties set on test File objects,
// since jsdom's Blob.text() / Blob.arrayBuffer() are not available in all versions.
global.FileReader = class MockFileReader {
  constructor() {
    this.result = null;
    this.onload = null;
    this.onerror = null;
  }

  readAsText(blob) {
    Promise.resolve().then(() => {
      if (blob._error) {
        if (this.onerror) this.onerror(new Error(blob._error));
        return;
      }
      this.result = blob._content !== undefined ? blob._content : '';
      if (this.onload) this.onload();
    });
  }

  readAsArrayBuffer(blob) {
    Promise.resolve().then(() => {
      if (blob._error) {
        if (this.onerror) this.onerror(new Error(blob._error));
        return;
      }
      this.result = blob._buffer !== undefined ? blob._buffer : new ArrayBuffer(0);
      if (this.onload) this.onload();
    });
  }
};
