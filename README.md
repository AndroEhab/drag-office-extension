# Drag to Sheets — Chrome Extension

Drag spreadsheet files into a side panel and open them in Google Sheets with built-in cleaning tools.

---

## Features

- **Drag & drop** files into the side panel (or click to browse)
- **Multiple files** — open each separately or merge into one spreadsheet
- **Per-file upload** — click the arrow on any file to open just that one
- **Smart merge** — aligns columns by header name across files, with automatic matching of common header variants
- **Custom column mapping** — manually map columns from source files to master headers
- **Formatting preservation** — preserves common Excel cell formatting (fonts, fills, borders, alignment, number formats) where supported by Google Sheets
- **URL import** — fetch spreadsheet files from a URL
- **Cleaning tools** before upload:
  - Trim whitespace
  - Remove empty rows
  - Remove empty columns
  - Remove duplicate rows (keep first or absolute)
  - Fix number formatting
  - Normalize header names
- **Preview** cleaned data before sending to Google Sheets
- **Keyboard shortcut** — `Ctrl+Shift+S` to open the panel

---

## Setup

### 1. Google Cloud Project

1. Go to the [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or select an existing one)
3. Enable these APIs:
   - **Google Sheets API**
   - **Google Drive API**
4. Go to **APIs & Services → Credentials**
5. Click **Create Credentials → OAuth 2.0 Client ID**
6. Select **Chrome Extension** as the application type
7. Copy the **Client ID**

### 2. Configure the Extension

Open `manifest.json` and replace the placeholder OAuth client ID:

```json
"oauth2": {
  "client_id": "YOUR_CLIENT_ID.apps.googleusercontent.com",
  ...
}
```

### 3. Load in Chrome

1. Open `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked** and select this project folder
4. Note the **Extension ID** shown on the card
5. Go back to Google Cloud Console → Credentials → your OAuth client
6. Add the extension ID under **Application ID**

### 4. Use the Extension

- Click the extension icon in the toolbar or press **Ctrl+Shift+S**
- Drag spreadsheet files into the drop zone
- Select cleaning options and open mode
- Click **Open in Sheets**

---

## Adding Excel Support (.xlsx / .xls)

CSV and TSV files work out of the box. For Excel support with formatting:

```bash
npm install
npm run setup
```

---

## Project Structure

```text
├── manifest.json              # Manifest V3 configuration
├── background.js              # Service worker
├── privacy.html               # Privacy policy
├── sidepanel/
│   ├── sidepanel.html         # Side panel UI
│   ├── sidepanel.css          # Styles
│   ├── sidepanel.js           # Main controller
│   ├── parser.js              # CSV/TSV/Excel file parsing
│   ├── cleaner.js             # Data cleaning utilities
│   ├── merger.js              # Multi-file merge logic
│   ├── exporter.js            # CSV/TSV/XLSX export
│   ├── google-api.js          # Sheets & Drive API wrapper
│   ├── file-handle-store.js   # FileSystemFileHandle persistence
│   └── processing-worker.js   # Web Worker for parsing/cleaning
├── lib/                       # Third-party libraries
├── images/                    # Extension icons
├── tests/                     # Jest test suite
└── package.json
```

---

## Supported File Types

| Format | Extension | Parser  |
|--------|-----------|---------|
| CSV    | `.csv`    | Native  |
| TSV    | `.tsv`    | Native  |
| Excel  | `.xlsx`   | SheetJS |
| Excel  | `.xls`    | SheetJS |

---

## Cleaning Options

| Option                  | Description                                        |
|-------------------------|----------------------------------------------------|
| Trim whitespace         | Removes leading/trailing spaces from every cell     |
| Remove empty rows       | Deletes rows where all cells are blank              |
| Remove empty columns    | Deletes columns where all cells are blank           |
| Remove duplicate rows   | Keep first occurrence or remove all instances       |
| Fix number formatting   | Converts text-formatted numbers to numbers          |
| Normalize headers       | Title Case, collapse spaces, trim header text       |

---

## Packaging

To create a production ZIP for Chrome Web Store upload:

```bash
npm run package
```

This runs setup, validates all manifest.json file references, and produces a versioned ZIP under `dist/` (e.g., `dist/drag-to-sheets-1.0.0.zip`). The archive includes only production files and extracts to the correct folder structure for loading as an unpacked extension.

---

## Chrome APIs Used

- `sidePanel` — side panel management
- `identity` — OAuth 2.0 authentication
- `storage` — session and preferences persistence
- `tabs` — open created spreadsheets
- `commands` — keyboard shortcuts
- `permissions` — optional host access for URL import

---

## License

MIT
