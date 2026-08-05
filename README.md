# Drag to Sheets — Chrome Extension

Drag spreadsheet files into a side panel and open them in Google Sheets with built-in cleaning tools.

---

## Features

- **Drag & drop** files into the side panel (or click to browse)
- **Multiple files** — open each separately or merge into one spreadsheet
- **Per-file upload** — click the arrow on any file to open just that one
- **Separate mode** — opens the full workbook (all worksheets) for each file
- **Merge mode** — combines one selected worksheet per file into a single spreadsheet
- **Worksheet selection** — pick which worksheet to merge when files contain multiple sheets
- **Smart merge** — aligns columns by header name across files, with automatic matching of common header variants
- **Custom column mapping** — manually map columns from source files to master headers
- **Formatting preservation** — preserves common Excel cell formatting (fonts, fills, borders, alignment, number formats) where supported by Google Sheets
- **URL import** — import live references from Google Sheets links or fetch supported CSV, TSV, XLSX, and XLS files from direct HTTPS URLs (per-origin permission required, 50 MB limit)
- **Custom workflows** â€” save a named master file, optional input files, worksheet choices, and cleaning/mapping settings for one-click runs
- **Master file locking** â€” an explicitly assigned workflow master stays at the top of the list; other files can still be reordered below it
- **Cleaning tools** before upload:
  - Trim whitespace
  - Remove empty rows and columns
  - Remove duplicate rows (keep first or absolute)
  - Fix number formatting
  - Normalize dates
  - Normalize header names
- **Preview** cleaned data before sending to Google Sheets
- **Privacy** — all file parsing, previewing, cleaning, and merging happens locally; data is sent to Google only when you click **Open in Sheets**
- **Keyboard shortcut** — `Ctrl+Shift+S` to open the panel

---

## Use the Extension

- Click the extension icon in the toolbar or press **Ctrl+Shift+S**
- Drag spreadsheet files into the drop zone
- Select cleaning options and open mode (separate or merge)
- Click **Open in Sheets**

For a repeatable merge, open **Custom workflows**, save the current setup, choose the master and any optional input files, then use **Run** later. Linked Google Sheets can be updated in place. Local files are available for one-click reuse only when they were selected through a persistent file handle; otherwise the workflow asks you to re-add them.

## Excel Support (.xlsx / .xls)

CSV and TSV files work out of the box. For Excel support with formatting:

```bash
npm install
npm run setup
```

## Development Setup

To configure the extension with your own Google Cloud OAuth client (needed for development or forking):

1. Create a project in the [Google Cloud Console](https://console.cloud.google.com/) and enable the **Sheets API** and **Drive API**
2. Create an OAuth 2.0 Client ID with **Chrome Extension** as the application type
3. Open `manifest.json` and replace the `client_id` in the `oauth2` block with your own
4. Load the extension unpacked at `chrome://extensions/` (enable Developer mode)
5. Add the extension ID to the OAuth client's **Application ID** field in Google Cloud Console

---

## Project Structure

```text
├── manifest.json              # Manifest V3 configuration
├── background.js              # Service worker
├── index.html                 # Landing page
├── privacy.html               # Privacy policy
├── design.md                  # Design specification
├── setup.js                   # Setup script (copies libraries into lib/)
├── scripts/
│   ├── package.js             # Production ZIP builder
│   └── validate-manifest.js   # Manifest reference validator
├── sidepanel/
│   ├── sidepanel.html         # Side panel UI
│   ├── sidepanel.css          # Styles
│   ├── sidepanel.js           # Main controller
│   ├── parser.js              # CSV/TSV/Excel file parsing
│   ├── cleaner.js             # Data cleaning utilities
│   ├── merger.js              # Multi-file merge logic
│   ├── exporter.js            # CSV/TSV/XLSX export
│   ├── google-api.js          # Sheets & Drive API wrapper
│   ├── type-detector.js       # Column type detection
│   ├── file-handle-store.js   # FileSystemFileHandle persistence
│   └── processing-worker.js   # Web Worker for parsing/cleaning
├── lib/                       # Third-party libraries (SheetJS, Lucide)
├── images/                    # Extension icons
├── tests/                     # Jest test suite
├── jest.config.js
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
| Trim whitespace         | Removes leading/trailing spaces from every cell         |
| Remove empty rows       | Deletes rows where all cells are blank                  |
| Remove empty columns    | Deletes columns where all cells are blank               |
| Remove duplicate rows   | Keep first occurrence or remove all instances           |
| Fix number formatting   | Converts text-formatted numbers to numbers              |
| Normalize dates         | Converts date strings to typed date cells               |
| Normalize headers       | Title Case, collapse spaces, trim header text           |

---

## Packaging

```bash
npm run package
```

This runs setup, validates all manifest.json file references, and produces a versioned ZIP under `dist/` (e.g., `dist/drag-to-sheets-1.0.0.zip`). The archive includes only production files and extracts to the correct folder structure for loading as an unpacked extension.

## Running Tests

```bash
npm test
```

Tests run via Jest. The CI workflow (`.github/workflows/ci.yml`) also runs `npm run setup` and `npm run package` to validate the production build.

---

## Chrome APIs Used

- `sidePanel` — side panel management
- `identity` — OAuth 2.0 authentication
- `storage` — session and preferences persistence
- `tabs` — open created spreadsheets
- `commands` — keyboard shortcut (`Ctrl+Shift+S`)
- `permissions` — optional per-origin HTTPS host access for URL import

---

## License

MIT
