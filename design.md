# Drag to Sheets — Side Panel Design Specification

## 1. Purpose

Refresh the Chrome side panel so it feels deliberate, modern, and trustworthy without turning it into an exaggerated marketing mockup.

The product should look like a polished utility that belongs beside Google Sheets: efficient, compact, calm, and professional. The redesign must improve hierarchy, readability, state clarity, and perceived quality while preserving all existing functionality.

This is a visual and interaction-design refresh, not a product rewrite.

---

## 2. Product Character

The interface should feel:

- Practical rather than playful
- Modern rather than decorative
- Compact rather than cramped
- Confident rather than flashy
- Closely related to spreadsheet workflows without copying Google Sheets pixel-for-pixel

The extension is a productivity tool. Users should immediately understand:

1. Where to add files
2. Which files are currently loaded
3. Whether files will open separately or be merged
4. Which cleaning operations will run
5. What the resulting data looks like
6. What the primary action will do

---

## 3. Non-Negotiable Engineering Constraints

### Preserve behavior

Do not remove, rename, or change the semantics of existing functionality:

- Drag-and-drop file import
- File picker import
- CSV, TSV, XLSX, and XLS support
- URL import
- Multiple-file handling
- Separate and merge modes
- Smart header mapping
- Custom column mapping
- Mapping review and approval
- Cleaning options
- Duplicate-removal modes
- Preview selection and table
- File reordering, removal, and individual opening
- Main Open in Sheets action
- Settings toggle
- Loading, progress, success, warning, and error states
- Session restoration and large-workload behavior

### Preserve JavaScript contracts

Existing element IDs are application contracts and must remain intact unless the JavaScript is updated safely in the same change.

Important IDs include, but are not limited to:

- `drop-zone`
- `file-input`
- `url-toggle`
- `url-bar`
- `url-input`
- `url-fetch-btn`
- `file-count`
- `clear-btn`
- `file-list`
- `options-panel`
- `merge-option`
- `smart-mapping-option`
- `opt-smart-mapping`
- `custom-mapping-option`
- `custom-mapping-list`
- `custom-mapping-add`
- `mapping-review`
- `mapping-review-list`
- `mapping-approve-btn`
- `mapping-decline-btn`
- `cleaning-options`
- `opt-trim`
- `opt-empty-rows`
- `opt-empty-cols`
- `opt-duplicates`
- `dup-mode`
- `opt-numbers`
- `opt-headers`
- `upload-btn`
- `settings-btn`
- `preview-panel`
- `preview-select`
- `preview-stats`
- `preview-table`
- `loading-panel`
- `loading-panel-bar`
- `loading-spinner`
- `loading-text`

### Keep the implementation lightweight

- Use the existing HTML, CSS, vanilla JavaScript, and Lucide icons.
- Do not introduce a UI framework.
- Do not add remote fonts, remote scripts, telemetry, or analytics.
- Avoid heavy animation and decorative image assets.
- Keep the extension compatible with its current Manifest V3 architecture.

---

## 4. Design Direction

### Core idea

Use a restrained neutral interface with one spreadsheet-green accent. Create visual quality through spacing, typography, grouping, alignment, and state feedback—not gradients, glass effects, oversized illustrations, or excessive shadows.

### Visual references

Aim for the clarity of modern Google Workspace utilities, Linear settings panels, and polished Chrome side-panel tools.

Do not imitate the generated promotional screenshots literally. The real interface should remain compact and plausible inside Chrome's side panel.

---

## 5. Design Tokens

Implement the visual system through CSS custom properties.

```css
:root {
  --color-accent: #188038;
  --color-accent-hover: #137333;
  --color-accent-pressed: #0d652d;
  --color-accent-soft: #e6f4ea;
  --color-accent-softer: #f3faf5;

  --color-bg: #ffffff;
  --color-bg-subtle: #f7f9fb;
  --color-bg-muted: #f1f4f7;
  --color-surface: #ffffff;

  --color-text: #1f2933;
  --color-text-secondary: #5f6b76;
  --color-text-muted: #7a8793;

  --color-border: #dfe4e8;
  --color-border-strong: #c9d1d8;

  --color-success: #188038;
  --color-success-bg: #e6f4ea;
  --color-warning: #b06000;
  --color-warning-bg: #fff4df;
  --color-error: #c5221f;
  --color-error-bg: #fce8e6;
  --color-info: #1967d2;
  --color-info-bg: #e8f0fe;

  --radius-xs: 5px;
  --radius-sm: 7px;
  --radius-md: 10px;
  --radius-lg: 14px;

  --shadow-xs: 0 1px 2px rgba(31, 41, 51, 0.06);
  --shadow-sm: 0 2px 8px rgba(31, 41, 51, 0.08);

  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;

  --transition-fast: 120ms ease;
  --transition-standard: 180ms ease;
}
```

The exact values may be refined during implementation, but the system must remain restrained and internally consistent.

---

## 6. Typography

Use the existing system-first font stack:

```css
font-family: "Google Sans", "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
```

Recommended scale:

- App title / important section title: 15–16px, 600
- Section heading: 12px, 650, sentence case
- Primary body text: 13px, 400–500
- Supporting text: 11–12px, 400
- Metadata: 11px, 400
- Button text: 13px, 600

Avoid uppercase section headings except for very small status labels. Sentence case is easier to scan and feels less utilitarian.

Use tabular numerals for row counts, file sizes, and preview data.

---

## 7. Overall Layout

### Side-panel canvas

- Support practical widths from approximately 320px to 600px.
- Default horizontal padding: 16px.
- Default vertical gap between major regions: 14–16px.
- Do not let every section become a separate heavy card.
- Use borders and subtle background changes only where they clarify hierarchy.

### Recommended vertical order

1. Header
2. Import surface
3. URL import disclosure
4. Files section
5. Open mode and mapping controls
6. Cleaning controls, when expanded
7. Preview, when available
8. Sticky or visually anchored action area
9. Status/progress panel

The main action should remain easy to find even when the preview is tall.

---

## 8. Header

### Goals

The current header should become lighter and more compact.

### Specification

- Display the existing horizontal logo at approximately 32–38px high rather than 56px.
- Keep the logo left-aligned.
- Place the beta badge close to the logo rather than at the far edge if that improves cohesion.
- Use a single subtle bottom divider or no divider if spacing provides enough separation.
- Header height should feel intentional but not consume a large part of the side panel.

### Beta badge

- Small neutral or green-tinted pill
- Lower contrast than the main content
- No strong uppercase tracking
- Suggested label: `Beta`

---

## 9. Empty Import State

The empty state is the most important first impression.

### Drop zone

- Full-width rounded rectangle
- 1.5–2px dashed border
- White or very light green-tinted background
- Minimum height around 132–150px
- Clear hover, keyboard-focus, and drag-over states
- Use the existing Lucide file-upload icon

### Content hierarchy

Primary line:

`Drop spreadsheet files here`

Secondary line:

`or click to browse`

Supported formats:

`CSV, TSV, XLSX, XLS`

The clickable behavior should be obvious without adding a separate browse button unless that improves accessibility.

### Interaction states

- Default: neutral border and muted icon
- Hover/focus: green border, subtle green background
- Drag over: solid green border, stronger soft-green background, slight icon movement or scale only
- Disabled/processing: visibly inactive without disappearing

Animation should be subtle and under 200ms.

---

## 10. URL Import

Treat URL import as a secondary pathway.

### Collapsed state

- Text button with link icon
- Label: `Import from URL`
- Low visual weight
- Chevron may be added to communicate disclosure

### Expanded state

- Place input and Import button in one row when width permits
- Stack vertically below approximately 360px if necessary
- Input height: 36–38px
- Keep the trust warning directly below the input
- Error state must use both color and text, not color alone

---

## 11. Files Section

### Section header

Left:

`Files` with a count badge or muted count text

Right:

`Clear all` as a quiet destructive text action

### File item

Each file should appear as a compact, clean row rather than a large card.

Recommended structure:

- File-type icon or document icon
- Filename, one line with ellipsis
- Metadata below: size and format
- Optional master badge
- Actions aligned on the right

### File-row styling

- White surface
- 1px border
- 8–10px radius
- 10–12px horizontal padding
- 8–10px vertical padding
- Very subtle hover shadow or border darkening
- No unnecessary background fill when the section already sits on white

### Actions

- Maintain minimum 28–32px hit areas
- Use tooltips or accessible labels
- Individual open action uses the accent color
- Reorder actions remain neutral
- Remove action becomes red only on hover/focus
- Disabled reorder controls remain visible but clearly inactive

### File-type differentiation

Use restrained icon color differences for CSV, TSV, and Excel where practical, but avoid bright multicolor decoration.

---

## 12. Open Mode

When multiple files exist, make the choice between separate and merged output visually clear.

### Preferred control

Use two segmented option cards or a compact two-option segmented control:

- `Open separately`
- `Merge into one`

Each option should include one short supporting line when enough width is available.

Selected state:

- Green border
- Soft-green background
- Stronger label weight
- Checked radio remains accessible and synchronized

Unselected state:

- Neutral border
- White background

Do not hide the native input from assistive technology.

---

## 13. Header Mapping

### Smart mapping option

Use a precise label that avoids implying semantic understanding:

`Match common header variants automatically`

Add a short explanation when space permits:

`Handles differences such as capitalization, spaces, underscores, hyphens, and simple plural forms.`

### Mapping review

The mapping-review state should look like a deliberate review step, not a generic alert.

Recommended structure:

- Header: `Review detected mappings`
- Supporting text: `These source headers will be combined into the same destination column.`
- Mapping rows showing source names and destination name
- Primary action: `Apply mappings`
- Secondary action: `Decline`

Use arrows, grouped chips, or a two-column row layout. Do not use decorative connector lines that become confusing at narrow widths.

### Custom mapping

Each mapping row should clearly separate:

- Source header selector
- Direction indicator
- Destination/master header selector
- Remove action

Use labels or column headings on the first row. Ensure dropdown text remains readable around 320px width.

The `+ Add mapping` action should be visible but secondary.

---

## 14. Cleaning Options

The settings button currently reveals cleaning controls. Preserve that interaction, but make the relationship clearer.

### Settings button

- Keep it adjacent to the main action
- Use a tooltip and accessible pressed state
- Active state uses soft green and green border
- Consider changing the accessible title to `Cleaning options`

### Cleaning panel

- Use one bordered section with a clear title and compact grid
- On wider panels, use two columns
- On narrow panels, use one column
- Each option should have enough vertical spacing to scan quickly

Visible labels remain:

- Trim whitespace
- Remove empty rows
- Remove empty columns
- Remove duplicate rows
- Fix number formatting
- Normalize header names

### Duplicate mode

When duplicate removal is enabled, reveal the two subordinate choices in an indented or nested surface:

- Keep first occurrence
- Remove all instances

The nested state must feel connected to the parent option.

---

## 15. Preview

The preview is a core differentiator and should feel integrated rather than appended.

### Preview container

- 1px border
- 10px radius
- White background
- Header with title, file selector, and stats
- Table scrolls horizontally and vertically inside the container

### Preview header

Preferred hierarchy:

- `Preview`
- Compact file selector
- Right-aligned stats such as `42 rows × 6 columns`

At narrow widths, allow the stats to wrap below rather than overlap.

### Table

- Sticky header
- Subtle header background
- Compact but comfortable row height
- Vertical separators only when they improve readability
- Hover state should be very subtle
- Use ellipsis for long cells while preserving full value through title/tooltip where practical
- Preserve horizontal scrolling
- Do not use green fills across the whole table

### Preview empty/deferred states

Use a centered informational message with an icon where helpful. Large-workload preview deferral should be calm and explanatory rather than error-like.

---

## 16. Primary Action Area

### Main action

The primary button is the visual anchor.

Label:

`Open in Sheets`

Behavior-specific labels may be used only when the application already knows the action precisely, for example:

- `Open files separately`
- `Merge and open in Sheets`

Avoid changing copy if it creates unnecessary JavaScript branching.

### Styling

- Height: 38–42px
- Green fill
- White text
- 7–9px radius
- 600 font weight
- Clear hover, pressed, focus, disabled, and loading states
- Use the existing external-open icon
- Disabled state should remain legible and should not rely on opacity below approximately 45%

### Position

Prefer a visually anchored action area near the bottom of the active workflow. If implementing sticky positioning, ensure it does not cover preview content and behaves correctly in Chrome's side-panel scrolling environment.

---

## 17. Status and Progress

The loading/status panel should communicate system state without looking like a permanent footer banner.

### Idle

Display the shortcut and a brief instruction quietly:

`Ctrl+Shift+S to open · Drop files to start`

### Processing

- Blue or green information tint
- Visible progress bar
- Spinner only when progress cannot be determined
- Specific status text whenever available

### Success

- Soft green background
- Success icon or check mark
- Concise result message

### Warning

- Soft amber background
- Clear explanation and next action

### Error

- Soft red background
- Error message should be selectable/readable
- Do not shake the panel or use aggressive animation

State colors must include icons or text so meaning is not color-dependent.

---

## 18. Focus, Keyboard, and Accessibility

- All interactive elements require visible `:focus-visible` rings.
- Focus ring should use a 2px accent outline or soft outer ring.
- Maintain logical DOM and tab order.
- Do not replace semantic buttons, labels, radios, checkboxes, lists, headings, or tables with generic divs.
- Ensure text contrast meets WCAG AA where practical.
- Keep hit areas at least approximately 28px, preferably 32px or larger.
- Respect `prefers-reduced-motion`.
- Do not communicate state through color alone.

---

## 19. Responsive Behavior

### 320–359px

- Single-column options
- URL input and button may stack
- File metadata may shorten
- Mapping controls may stack vertically
- Preview header may wrap

### 360–479px

- Default target layout
- Two-column cleaning options may be used only if labels remain readable
- Open-mode cards can remain side by side

### 480px and above

- Use space to improve readability, not to inflate components
- Cleaning options can use two columns
- Mapping rows can use stronger source-to-destination alignment
- Preview can show more columns before horizontal scrolling

No horizontal page-level overflow is allowed. Only the preview table may scroll horizontally.

---

## 20. Motion

Use motion sparingly:

- Hover/focus transitions: 120–180ms
- Section disclosure: simple opacity/height transition only if implementation remains reliable
- Drag-over icon: small translate or scale
- Progress bar: smooth width change

Do not use bouncing, pulsing, background animation, or large transforms.

---

## 21. State Checklist

The finished interface must be reviewed in all of these states:

1. Empty panel
2. Drag-over state
3. URL import expanded
4. One file loaded
5. Multiple files loaded
6. Open separately selected
7. Merge selected
8. Smart mapping available
9. Mapping review displayed
10. Custom mapping displayed
11. Cleaning options collapsed
12. Cleaning options expanded
13. Duplicate-removal sub-options displayed
14. Preview displayed
15. Preview with long headers and cells
16. Large-workload/deferred preview message
17. Main action disabled
18. Processing state
19. Success state
20. Warning state
21. Error state
22. Restored session state
23. Narrow side panel
24. Wide side panel

---

## 22. Implementation Scope

Primary files expected to change:

- `sidepanel/sidepanel.html`
- `sidepanel/sidepanel.css`

Change `sidepanel/sidepanel.js` only when required to:

- Add safe state classes
- Improve accessible labels or state attributes
- Support behavior-specific copy
- Preserve interaction after necessary DOM refinement

Do not alter parser, cleaning, merging, API, storage, or export logic as part of this design task unless a UI defect cannot be resolved otherwise.

---

## 23. Verification

After implementation:

1. Run `npm test`.
2. Check for JavaScript console errors.
3. Confirm every existing control still responds.
4. Confirm file drag-and-drop and file-picker import.
5. Confirm URL import disclosure and validation.
6. Confirm single-file and multi-file workflows.
7. Confirm separate and merged modes.
8. Confirm smart and custom mapping flows.
9. Confirm all cleaning options and duplicate modes.
10. Confirm preview scrolling and file selection.
11. Confirm status states.
12. Confirm layout at 320px, 360px, 420px, 480px, and 600px widths.
13. Confirm keyboard navigation and focus visibility.
14. Confirm no page-level horizontal overflow.

---

## 24. Acceptance Criteria

The redesign is complete when:

- The extension looks visibly more polished than the current implementation without appearing like a fictional marketing UI.
- The empty state explains the product immediately.
- The file list, options, preview, and main action have a clear visual hierarchy.
- The interface remains compact enough for a Chrome side panel.
- All current workflows remain functional.
- Existing DOM/JavaScript contracts are preserved or safely updated.
- The design works from narrow to wide side-panel widths.
- The test suite passes.
- No remote assets, frameworks, analytics, or unnecessary dependencies are added.
