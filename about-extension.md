# Element Inspector

A cross-browser developer tool for inspecting webpage elements, understanding how they are styled and structured, identifying associated JavaScript behavior, and reproducing selected elements outside the original page.

Element Inspector runs as a browser extension for **Chrome/Chromium** and **Firefox 128+** and provides both an on-page inspector and a dedicated DevTools panel.

---

## Features

Element Inspector provides several ways to investigate a selected DOM element.

### Element inspection

- Hover over elements directly on the page.
- Click to select an element.
- Display the selected element's selector and metadata.
- Navigate the surrounding DOM structure.
- Inspect parent, child, and sibling relationships.

### HTML

View the markup associated with the selected element.

### CSS

Inspect CSS rules associated with the element, including styles discovered from page stylesheets.

### Computed styles

View the browser's final computed CSS values for the selected element.

### CSS variables

Inspect CSS custom properties associated with the element and its rendered styles.

### JavaScript associations

Search the JavaScript loaded by the page for code that can be associated with the selected element.

Because modern applications frequently use compiled, minified, bundled, or framework-generated JavaScript, this analysis is intentionally **heuristic**.

Element Inspector reports JavaScript that can be confidently associated with the selected element rather than claiming to reconstruct the application's exact source component.

### DOM tree

Explore a configurable snapshot of the DOM surrounding the selected element.

### Preview

Generate a standalone preview of the selected element using the HTML and styling discovered during inspection.

### Export

Inspection results can be:

- Copied
- Downloaded
- Previewed
- Exported to CodePen

### Dockable inspector

The on-page inspector can be:

- Dragged
- Resized
- Docked
- Snapped
- Repositioned within viewport constraints

---

## DevTools Integration

Element Inspector adds its own browser DevTools panel.

It can work alongside the browser's native element inspector and synchronize selections using the native DevTools `$0` reference.

Typical workflows include:

- Select an element with Element Inspector's **Pick element** control.
- Select an element in the browser's native Elements/Inspector panel.
- Use **Inspect `$0`** to synchronize the native DevTools selection with Element Inspector.

The DevTools integration uses browser DevTools APIs such as `inspectedWindow.eval()` and communicates with the extension through a runtime port.

---

## Theme Support

Element Inspector supports both **Light** and **Dark** themes.

The selected theme is stored in extension local storage and synchronized across:

- Popup
- Page inspector
- Docked inspector
- DevTools panel

The interface also respects:

```css
prefers-reduced-motion
```

---

# Browser Support

Element Inspector uses a **single TypeScript codebase** with browser-specific manifest generation during the Vite build.

Supported targets:

- Google Chrome
- Chromium-based browsers using Chrome Manifest V3
- Firefox 128+

The browser target is controlled through:

```text
TARGET
```

Supported values:

```text
chrome
firefox
```

Chrome is the default:

```ts
const target = (process.env.TARGET ?? "chrome") as BuildTarget;
```

---

# Installation

Install project dependencies:

```bash
npm install
```

---

# Build for Chrome

Chrome is the default build target.

```bash
npm run build
```

This is equivalent to:

```bash
TARGET=chrome npm run build
```

The extension is generated in:

```text
dist/
```

A production ZIP archive is also generated:

```text
dist-chrome.zip
```

---

## Load in Chrome

After building:

1. Open Chrome.
2. Navigate to:

```text
chrome://extensions
```

3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select the project's:

```text
dist/
```

directory.

6. Open a normal webpage.
7. Click the **Element Inspector** extension icon.
8. Select **Inspect Element**.

### Chrome DevTools

1. Open Chrome DevTools.
2. Locate the **Element Inspector** tab.
3. Click **Pick element** to activate the custom picker.

You can also select an element in Chrome's native **Elements** panel and synchronize the current `$0` element with Element Inspector.

---

# Build for Firefox

Firefox builds require a Gecko extension ID.

```bash
TARGET=firefox \
FF_ADDON_ID=element-inspector@example.com \
npm run build
```

Replace:

```text
element-inspector@example.com
```

with the Firefox add-on ID assigned to your extension.

The extension is generated in:

```text
dist/
```

A production ZIP archive is also generated:

```text
dist-firefox.zip
```

Firefox builds intentionally fail when `FF_ADDON_ID` is not provided.

---

## Load in Firefox

After building:

1. Open Firefox.
2. Navigate to:

```text
about:debugging#/runtime/this-firefox
```

3. Click **Load Temporary Add-on**.
4. Select:

```text
dist/manifest.json
```

5. Open a normal webpage.
6. Click the **Element Inspector** extension icon.
7. Select **Inspect Element**.

### Firefox DevTools

1. Open Firefox Developer Tools.
2. Locate the **Element Inspector** panel.
3. Click **Pick element** to activate the custom picker.

You can also select an element using Firefox's native Inspector.

Use **Inspect `$0`** to explicitly synchronize the current native DevTools selection with Element Inspector.

---

# Development

The project is written primarily in:

- TypeScript
- HTML
- CSS
- WebExtensions APIs
- Vite

It uses:

```text
webextension-polyfill
```

for browser-extension APIs.

Browser-specific differences are handled during the build rather than by maintaining separate application codebases.

If the project defines a Vite watch command, development builds can be generated with:

```bash
npm run dev
```

Load the generated extension from:

```text
dist/
```

After rebuilding, reload the extension in the browser and refresh the page being inspected.

### Chrome

Open:

```text
chrome://extensions
```

and click **Reload** for Element Inspector.

### Firefox

Open:

```text
about:debugging#/runtime/this-firefox
```

and click **Reload** for the temporary extension.

---

# Cross-Browser Manifest Generation

Element Inspector keeps one source manifest and transforms it during the build.

The Vite plugin:

```text
webextension-manifest-target-fix
```

generates the appropriate background configuration for the selected browser.

## Chrome / Chromium

Chrome uses a Manifest V3 service worker:

```json
{
  "background": {
    "service_worker": "background.js",
    "type": "module"
  }
}
```

Firefox-specific `browser_specific_settings` are removed from the generated Chrome manifest.

## Firefox

Firefox uses:

```json
{
  "background": {
    "scripts": ["background.js"],
    "type": "module"
  }
}
```

The build also adds:

```json
{
  "browser_specific_settings": {
    "gecko": {
      "id": "<FF_ADDON_ID>",
      "strict_min_version": "128.0"
    }
  }
}
```

This allows the same extension source code to produce manifests appropriate for both browsers.

---

# Build Configuration

Vite builds several browser-extension entry points:

```ts
rollupOptions: {
  input: {
    popup: "src/popup.html",
    devtools: "src/devtools.html",
    "devtools-panel": "src/devtools-panel.html",
    content: "src/components/content/content.ts",
    background: "src/background.ts",
  },
}
```

The background script always receives the stable filename:

```text
background.js
```

This is important because both generated browser manifests reference that file directly.

Other generated JavaScript bundles are placed under:

```text
assets/
```

---

# Build Output

The generated extension has a structure similar to:

```text
dist/
├── manifest.json
├── background.js
├── popup.html
├── devtools.html
├── devtools-panel.html
└── assets/
```

---

# ZIP Packaging

Production builds automatically generate a compressed archive of the generated `dist/` directory.

### Chrome

```text
dist-chrome.zip
```

### Firefox

```text
dist-firefox.zip
```

The archive uses ZIP level 9 compression.

A separate manual packaging step is therefore not required for normal production builds.

---

# Environment Variables

## `TARGET`

Controls which browser manifest is generated.

Supported values:

```text
chrome
firefox
```

Chrome:

```bash
TARGET=chrome npm run build
```

Firefox:

```bash
TARGET=firefox \
FF_ADDON_ID=element-inspector@example.com \
npm run build
```

When `TARGET` is omitted:

```text
chrome
```

is used.

Unsupported values cause the build to fail.

---

## `FF_ADDON_ID`

Required for Firefox builds.

Example:

```bash
FF_ADDON_ID=element-inspector@example.com
```

If:

```text
TARGET=firefox
```

is supplied without an add-on ID, the build intentionally stops with:

```text
FF_ADDON_ID is required for firefox builds
```

---

## `VITE_INSPECTOR_DEBUG`

Controls inspector development logging.

Example:

```bash
VITE_INSPECTOR_DEBUG=true npm run build
```

When enabled, messages are prefixed with:

```text
[Element Inspector]
```

Debug logging covers areas such as:

- Inspector state
- Element selection
- Dock behavior
- Extension messaging
- Content inspection
- State synchronization

---

# Architecture

Element Inspector is divided into several cooperating browser-extension contexts.

```text
┌──────────────────────────┐
│      Extension Popup     │
│                          │
│ Start / Stop / Theme     │
└─────────────┬────────────┘
              │
              │ runtime messages
              ▼
┌──────────────────────────┐
│     Background Script    │
│                          │
│ Message routing          │
│ Resource fetching        │
│ Theme broadcasting       │
│ DevTools port routing    │
└─────────────┬────────────┘
              │
              │ tabs.sendMessage()
              ▼
┌──────────────────────────┐
│      Content Script      │
│                          │
│ Inspector                │
│ Overlay                  │
│ Docking panel            │
│ Element analysis         │
└─────────────┬────────────┘
              │
              ▼
┌──────────────────────────┐
│     Inspected Webpage    │
└──────────────────────────┘


┌──────────────────────────┐
│     DevTools Panel       │
│                          │
│ Native $0 sync           │
│ Inspector controls       │
└─────────────┬────────────┘
              │
              ├──── runtime port ────► Background
              │
              └──── inspectedWindow.eval()
                         │
                         ▼
                 Native DevTools
```

---

# Core Components

## `Inspector`

Coordinates the primary inspection lifecycle.

Responsibilities include:

- Starting and stopping element picking
- Tracking the current element
- Rendering the overlay
- Managing the docking panel
- Synchronizing inspector state
- Handling theme changes
- Publishing state changes

---

## `InspectorContent`

Builds and manages the data displayed inside the inspector.

Responsibilities include:

- Element information
- HTML
- CSS
- Computed CSS
- CSS variables
- JavaScript associations
- DOM tree snapshots
- Preview generation
- Copy actions
- Download actions
- Export actions

Expensive inspection data is loaded lazily when needed.

---

## `InspectorPanelRenderer`

Converts inspector view models into the interface displayed in each inspector tab.

---

## `Panel`

Provides the reusable floating and dockable panel system.

Responsibilities include:

- Dragging
- Resizing
- Docking
- Snapping
- Viewport constraints
- Visibility lifecycle

---

# Extension Messaging

The extension's different execution contexts communicate through runtime messages.

Important messages include:

```text
ELEMENT_INSPECTOR_START
ELEMENT_INSPECTOR_STOP
ELEMENT_INSPECTOR_GET_STATE
ELEMENT_INSPECTOR_GET_VIEW_MODEL
ELEMENT_INSPECTOR_INSPECT_SELECTOR
ELEMENT_INSPECTOR_SET_TREE_DEPTH
ELEMENT_INSPECTOR_TOGGLE_TREE_CHILDREN
ELEMENT_INSPECTOR_STATE_CHANGED
ELEMENT_INSPECTOR_THEME_CHANGED
ELEMENT_INSPECTOR_DEVTOOLS_CONNECT
ELEMENT_INSPECTOR_FETCH_RESOURCE
```

The background script acts as the central router between:

```text
Popup
   │
   ▼
Background
   │
   ├────────► Content Script
   │
   └────────► DevTools Panel
```

---

# Project Structure

```text
src/
├── background.ts
├── manifest.json
├── popup.html
├── popup.ts
├── popup.css
├── theme.css
│
├── devtools.html
├── devtools-panel.html
│
├── components/
│   ├── content/
│   │
│   ├── devtools/
│   │
│   ├── DockingPanel/
│   │
│   └── Inspector/
│
└── utils/
```

# Permissions

The extension declares permissions including:

```json
[
  "activeTab",
  "tabs",
  "storage",
  "scripting",
  "identity",
  "contextMenus",
  "downloads"
]
```

It also declares:

```json
{
  "host_permissions": ["<all_urls>"]
}
```

These permissions support functionality such as:

- Inspecting the active webpage
- Communicating with inspected tabs
- Synchronizing extension state
- Injecting required extension functionality
- Reading resources needed during inspection
- Creating downloads and exports

---

# Resource Access and Privacy

Element Inspector performs its analysis primarily against the currently loaded webpage.

JavaScript and stylesheet inspection may require reading resources referenced by the page.

The background script supports fetching:

```text
http:
https:
data:
```

resources and can use the browser's current credentials where applicable.

The supplied extension source does not contain a separate analytics or telemetry service.

## CodePen export

**Open in CodePen** is an explicit user-triggered export action.

When selected, generated preview content is submitted to CodePen so the preview can be opened there.

---

# Known Limitations

## JavaScript association is heuristic

Rendered DOM elements do not necessarily have a direct relationship with a specific function in a production JavaScript bundle.

This is particularly common with applications built using frameworks, bundlers, compilers, or minifiers.

Element Inspector therefore identifies JavaScript that can be **confidently associated** with an element rather than claiming to reconstruct the application's exact source code.

---

## Source maps

Compiled JavaScript may originate from:

- TypeScript
- JSX
- TSX
- Vue components
- Other source languages

Original application source cannot always be reconstructed without source maps.

# Build Examples

## Chrome

```bash
TARGET=chrome npm run build
```

Produces:

```text
dist/
dist-chrome.zip
```

## Firefox

```bash
TARGET=firefox \
FF_ADDON_ID=element-inspector@example.com \
npm run build
```

Produces:

```text
dist/
dist-firefox.zip
```

## Default

Because Chrome is the default build target:

```bash
npm run build
```

is equivalent to:

```bash
TARGET=chrome npm run build
```

---

# Design Approach

Element Inspector intentionally uses a **single source codebase with browser-specific build-time manifest generation**.

The primary background-script difference is handled automatically during the build:

```text
Chrome / Chromium

background.service_worker
          │
          ▼
    background.js
```

```text
Firefox

background.scripts
          │
          ▼
  ["background.js"]
```

This keeps the inspector implementation shared while producing a browser-appropriate Manifest V3 configuration for each supported target.
