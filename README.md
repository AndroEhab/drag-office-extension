# Drag to Sheets — Chrome Extension

Drag spreadsheet files into a side panel and open them in Google Sheets with built-in cleaning tools.

**MVP scope:** Google Sheets only (`.csv`, `.tsv`, `.xlsx`, `.xls`).

---

## Features

- **Drag & drop** files into the side panel (or click to browse)
- **Multiple files** — open each separately or merge into one spreadsheet
- **Smart merge** — aligns columns by header name across files
- **Cleaning tools** before upload:
  - Trim whitespace
  - Remove empty rows
  - Remove empty columns
  - Remove duplicate rows
  - Fix number formatting (text → numbers)
  - Normalize header names (Title Case, collapse spaces)
- **Preview** cleaned data before sending to Google Sheets
- **Auto-formatting** — frozen header row, bold headers, auto-sized columns
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
7. You'll need the extension ID (see step 3 below) — you can come back to fill this in
8. Copy the **Client ID**

### 2. Configure the Extension

Open `manifest.json` and replace the placeholder:

```json
"oauth2": {
  "client_id": "YOUR_CLIENT_ID.apps.googleusercontent.com",
  ...
}
```

### 3. Load in Chrome

1. Open `chrome://extensions/`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** and select this project folder
4. Note the **Extension ID** shown on the card
5. Go back to Google Cloud Console → Credentials → your OAuth client
6. Add the extension ID under **Application ID**

### 4. Use the Extension

- Click the extension icon in the toolbar to open the side panel
- Or press **Ctrl+Shift+S** (Cmd+Shift+S on Mac)
- Drag spreadsheet files into the drop zone
- Select cleaning options
- Click **Open in Sheets**

---

## Adding Excel Support (.xlsx / .xls)

CSV and TSV files work out of the box. For Excel files, you need the [SheetJS](https://sheetjs.com/) library:

### Option A: npm

```bash
npm install
npm run setup
```

### Option B: Manual download

1. Download `xlsx.full.min.js` from [SheetJS CDN](https://cdn.sheetjs.com/xlsx-latest/package/dist/xlsx.full.min.js)
2. Place it in `lib/xlsx.full.min.js`

---

## Project Structure

```text
drag-office-extension/
├── manifest.json          # Manifest V3 configuration
├── background.js          # Service worker (panel open + shortcuts)
├── sidepanel/
│   ├── sidepanel.html     # Side panel UI
│   ├── sidepanel.css      # Styles
│   ├── sidepanel.js       # Main controller
│   ├── parser.js          # CSV/TSV/Excel file parsing
│   ├── cleaner.js         # Data cleaning utilities
│   ├── merger.js          # Multi-file merge logic
│   └── google-api.js      # Sheets & Drive API wrapper
├── lib/                   # Third-party libraries (SheetJS)
│   └── xlsx.full.min.js   # (install via npm or manual download)
├── package.json           # npm config (for SheetJS setup)
└── README.md
```

---

## Supported File Types

| Format | Extension    | Parser        | Status          |
|--------|-------------|---------------|-----------------|
| CSV    | `.csv`      | Native        | ✅ Ready        |
| TSV    | `.tsv`      | Native        | ✅ Ready        |
| Excel  | `.xlsx`     | SheetJS       | Requires setup  |
| Excel  | `.xls`      | SheetJS       | Requires setup  |

---

## Cleaning Options

| Option                  | Description                                           |
|------------------------|-------------------------------------------------------|
| Trim whitespace        | Removes leading/trailing spaces from every cell       |
| Remove empty rows      | Deletes rows where all cells are blank                |
| Remove empty columns   | Deletes columns where all cells are blank             |
| Remove duplicate rows  | Keeps first occurrence, removes exact duplicates      |
| Fix number formatting  | Converts text-formatted numbers ("123") to numbers    |
| Normalize headers      | Title Case, collapse spaces, trim header cell text    |

---

## Development

- Built with Chrome Manifest V3
- No build step required for CSV/TSV support
- Side Panel API (Chrome 116+)
- OAuth 2.0 via `chrome.identity`
- Google Sheets API v4 for spreadsheet creation

### Chrome APIs Used

- `chrome.sidePanel` — side panel management
- `chrome.commands` — keyboard shortcuts
- `chrome.identity` — OAuth 2.0 authentication
- `chrome.tabs` — open created spreadsheets

---

## Roadmap (Post-MVP)

- [ ] Google Docs support (Word files)
- [ ] Google Slides support (PowerPoint files)
- [ ] Drag from web pages (download + convert)
- [ ] History of converted files
- [ ] Batch rename sheets on merge
- [ ] Column type detection and formatting
- [ ] Dark mode

---

## License

MIT
