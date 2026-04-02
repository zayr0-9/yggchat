# Right Bar Browser Pane Spec

## Overview

Add a built-in browser tab to the Electron desktop app by embedding an Electron `<webview>` inside the existing docked pane system in `src/containers/rightBar.tsx`.

This browser pane should behave like the existing Monaco editor and Xterm terminal panes:
- open inside the right-side dock area
- participate in the shared dock tab strip
- support multiple open browser tabs
- preserve per-tab navigation state
- remain Electron-only

Web mode is intentionally out of scope.

---

## Goals

1. Add a real in-app browser experience for arbitrary websites.
2. Reuse the existing right-bar dock and tab architecture.
3. Support multiple browser tabs alongside file, diff, and terminal tabs.
4. Keep the implementation renderer-driven, with minimal new Electron main-process complexity.
5. Keep the browser surface isolated from app internals.

---

## Non-Goals

1. No support for web runtime.
2. No attempt to make the browser a full standalone Chrome-like subsystem.
3. No bookmark/history/download manager in phase 1.
4. No deep tab persistence across launches in phase 1 unless it is very low effort.
5. No preload bridge exposed to arbitrary remote pages in phase 1.
6. No BrowserView/WebContentsView-based embedding in phase 1.

---

## Why `<webview>`

### Chosen approach

Use Electron `<webview>` inside a new React component rendered in the existing dock panel.

### Why this approach fits the current app

The app already has:
- a shared dock-tab model in `rightBar.tsx`
- pane components for editor/diff/terminal
- Electron enabled with `webviewTag: true` in `electron/main.ts`
- a renderer-first architecture for docked tools

This makes `<webview>` the best fit for a real browser tab without moving layout ownership into the main process.

### Why not `iframe`

`iframe` is insufficient for a general-purpose browser because many websites block framing with CSP or `X-Frame-Options`.

### Why not `BrowserView` or `WebContentsView`

Those would provide more native control, but they are a worse match for the current React-driven dock layout and would significantly increase complexity around sizing, focus, and tab embedding.

---

## Current Architecture Summary

Relevant files:
- `client/ygg-chat-r/src/containers/rightBar.tsx`
- `client/ygg-chat-r/src/components/XtermTerminalPane/XtermTerminalPane.tsx`
- `client/ygg-chat-r/src/components/MonacoFileEditorPane/MonacoFileEditorPane.tsx`
- `client/ygg-chat-r/electron/main.ts`
- `client/ygg-chat-r/electron/preload.ts`

### Existing right bar behavior

`rightBar.tsx` already manages:
- `openFileEditors`
- `openGitDiffTabs`
- `openTerminalTabs`
- `activeDockTabId`
- a shared `dockTabs` array consumed by pane components
- active-pane switching based on dock tab ID prefixes

This gives us a natural place to add:
- `openBrowserTabs`
- `activeBrowserDock`
- `getBrowserDockTabId()`
- browser-aware close/select/open handlers

### Existing pane pattern

`XtermTerminalPane.tsx` is the best reference for the browser pane because it:
- renders within the same dock shell shape
- consumes the shared tab strip item model
- owns its own live embedded surface
- handles focus and resize lifecycle

---

## Functional Requirements

### 1. Open browser tab

The user must be able to open a browser pane in the right dock.

Phase 1 acceptable entry points:
- a button in the right-bar terminal section
- a button near other dock actions
- an internal helper callable from future UI surfaces

When opened:
- a new browser dock tab is created
- the right bar expands if collapsed
- the new browser tab becomes active
- the pane loads an initial URL

Default initial URL:
- `https://example.com` or a project-defined neutral home page
- exact default should be configurable in code, but does not need user settings in phase 1

### 2. Multiple browser tabs

The system must support multiple open browser tabs at once.

Each browser tab maintains independent state:
- requested URL
- current URL after redirects/navigation
- title
- loading state
- navigation ability (`canGoBack`, `canGoForward`)
- basic error state if desired

### 3. Shared dock tab strip integration

Browser tabs must appear in the existing `dockTabs` list and coexist with:
- file tabs
- diff tabs
- terminal tabs

Browser tabs should:
- have `kind: 'browser'`
- have their own color/icon treatment in the shared tab strip
- support close and activate interactions just like other dock tabs

### 4. Browser chrome inside pane

The browser pane must include:
- Back button
- Forward button
- Reload button
- Address bar
- Go/Open button
- current page title display
- loading indicator or loading status text
- Close button
- DevTools button when guest-page DevTools are enabled in Settings

Optional for phase 1:
- Home button
- Stop button
- Open externally button

### 5. Navigation behavior

The address bar should support:
- direct `http://` and `https://` URLs
- hostnames like `google.com` normalized to `https://google.com`
- optionally search fallback later, but not required in phase 1

When navigation occurs through page links or redirects:
- `currentUrl` updates from webview events
- tab title updates from page title events
- nav button enabled state updates from webview state

### 6. Electron-only rendering

Browser pane functionality is only available in Electron runtime.

If somehow rendered without Electron support, the pane should fail gracefully with a simple unsupported message instead of crashing.

### 7. Guest-page DevTools

The browser should support opening DevTools for the embedded guest page, separate from the app renderer DevTools.

Implementation requirements:
- renderer gets the guest `webContentsId` from the active `<webview>`
- renderer requests DevTools opening through preload API
- main process resolves `webContents.fromId(id)` and calls `openDevTools({ mode: 'detach', activate: true })`
- availability is controlled by a Settings toggle, not by debug mode
- if disabled in Settings, the Browser pane should hide or disable the DevTools affordance and the main process should reject the IPC request

Current IPC names:
- `browser:isGuestDevToolsEnabled`
- `browser:openGuestDevTools`

Current Settings storage:
- renderer helper: `src/helpers/browserSettingsStorage.ts`
- storage key: `ygg_browser_settings`
- field: `guestDevToolsEnabled`

---

## UX Requirements

### Tab labeling

Browser dock tabs should use:
- page title when available
- otherwise hostname
- otherwise fallback label like `Browser`

### Visual treatment

Browser tabs should be visually distinct from file/diff/terminal tabs, similar to the current per-kind tinting already used.

Recommended new tab kind styling:
- active: amber/orange family
- inactive: lighter amber/orange family

### Empty/loading/error states

The pane should clearly distinguish:
- initial loading
- normal browsing
- failed load / invalid URL
- unsupported environment

### Focus behavior

When a browser tab becomes active:
- the address bar should not steal focus every time
- the webview should remain interactable
- focus should feel comparable to terminal/editor panes

---

## Proposed State Model

Add a new browser dock state in `rightBar.tsx`.

```ts
type BrowserDockState = {
  id: string
  title: string
  requestedUrl: string
  currentUrl: string
  isLoading: boolean
  canGoBack: boolean
  canGoForward: boolean
  lastError: string | null
}
```

### ID conventions

Add helper:

```ts
const getBrowserDockTabId = (browserId: string): string => `browser:${browserId}`
```

### New state slice inside component

```ts
const [openBrowserTabs, setOpenBrowserTabs] = useState<BrowserDockState[]>([])
```

### New active dock resolver

```ts
const activeBrowserDock = useMemo(
  () =>
    activeDockTabId?.startsWith('browser:')
      ? (openBrowserTabs.find(tab => getBrowserDockTabId(tab.id) === activeDockTabId) ?? null)
      : null,
  [activeDockTabId, openBrowserTabs]
)
```

---

## Shared Tab Model Changes

File: `src/components/MonacoFileEditorPane/MonacoFileEditorPane.tsx`

Current:

```ts
kind?: 'file' | 'diff' | 'terminal'
```

Change to:

```ts
kind?: 'file' | 'diff' | 'terminal' | 'browser'
```

Then update shared tab-strip styling in:
- `MonacoFileEditorPane.tsx`
- `XtermTerminalPane.tsx`
- any other pane using the shared tab strip model

to support browser tone classes.

---

## New Component

Create:
- `client/ygg-chat-r/src/components/BrowserPane/BrowserPane.tsx`

Also export it through the local components barrel if that pattern is currently used.

### Component responsibilities

`BrowserPane` should:
- render the shared dock tab strip using the existing `tabs` model
- render browser controls
- own the `<webview>` element lifecycle
- subscribe to webview navigation/loading/title events
- report state changes back to `rightBar.tsx`
- support tab close/select actions

### Suggested props

```ts
interface BrowserPaneProps {
  tabId: string
  title: string
  requestedUrl: string
  currentUrl: string
  isLoading: boolean
  canGoBack: boolean
  canGoForward: boolean
  lastError: string | null
  theme: 'vs' | 'vs-dark'
  tabs: MonacoPaneTabItem[]
  activeTabId: string | null
  onNavigate: (url: string) => void
  onBack: () => void
  onForward: () => void
  onReload: () => void
  onStateChange: (next: {
    title?: string
    currentUrl?: string
    isLoading?: boolean
    canGoBack?: boolean
    canGoForward?: boolean
    lastError?: string | null
  }) => void
  onClose: () => void
  onSelectTab: (tabId: string) => void
  onCloseTab: (tabId: string) => void
}
```

### Internal refs

`BrowserPane` will likely need:
- `webviewRef`
- local address bar draft state
- optional ref to prevent duplicate event bindings

---

## `<webview>` Element Requirements

### Base element

The embedded browser surface should use Electron `<webview>`.

Representative shape:

```tsx
<webview
  ref={webviewRef}
  src={requestedUrl}
  className='h-full w-full'
  allowpopups
  partition='persist:ygg-browser'
/>
```

### Recommended initial settings

Phase 1:
- `allowpopups`: enabled only if wanted for standard browser behavior
- `partition='persist:ygg-browser'`: shared persistent session for cookies/login state
- no custom preload for the guest page

### Important note for TypeScript/React

React does not strongly type Electron `webview` out of the box in many setups.

We will likely need either:
1. a local element cast such as `useRef<any>(null)`, or
2. a lightweight custom TypeScript declaration for `webview`

Phase 1 can use a targeted cast if necessary.

---

## Webview Event Handling

`BrowserPane` should subscribe to the following events on the webview as available:
- `did-start-loading`
- `did-stop-loading`
- `did-fail-load`
- `did-navigate`
- `did-navigate-in-page`
- `page-title-updated`
- optionally `dom-ready`

### Event-to-state mapping

#### `did-start-loading`
- set `isLoading = true`
- clear transient error if appropriate

#### `did-stop-loading`
- set `isLoading = false`
- query and update `canGoBack` / `canGoForward`

#### `did-fail-load`
- set `isLoading = false`
- set `lastError`

#### `did-navigate` and `did-navigate-in-page`
- update `currentUrl`
- refresh `canGoBack` / `canGoForward`

#### `page-title-updated`
- update `title`

### State synchronization rule

`rightBar.tsx` remains the source of truth for browser tab state.
`BrowserPane` is responsible for observing webview changes and pushing them upward via callbacks.

---

## URL Normalization Rules

Create a small helper, either inside `BrowserPane.tsx` or a nearby utility file.

### Rules

1. Trim whitespace.
2. If input begins with `http://` or `https://`, use as-is.
3. If input looks like a bare hostname, prepend `https://`.
4. Reject unsupported protocols in phase 1, including:
   - `javascript:`
   - `file:`
   - `data:` unless explicitly needed later
5. If invalid, do not navigate and surface a lightweight error.

### Out of scope for phase 1

- search engine fallback from plain text
- custom internal URL schemes
- special handling for local files

---

## Right Bar Integration Plan

File: `src/containers/rightBar.tsx`

### 1. Imports

Add import for `BrowserPane` from components barrel or direct path.

### 2. New types

Add `BrowserDockState`.

### 3. New state

Add `openBrowserTabs`.

### 4. New helpers

Add:
- `getBrowserDockTabId`
- `createBrowserStateId`
- `openBrowserDock`
- `closeBrowserDock`
- `updateBrowserDock`
- browser navigation handlers for active tab

### 5. Dock tab list

Extend `dockTabs` to include browser tabs.

Representative mapping:

```ts
...openBrowserTabs.map(tab => ({
  id: getBrowserDockTabId(tab.id),
  label: tab.title || 'Browser',
  title: tab.currentUrl || tab.requestedUrl,
  kind: 'browser' as const,
  isDirty: false,
  isSaving: false,
}))
```

### 6. Active pane selection

Add `activeBrowserDock` memo.

### 7. Render switch

Extend the dock rendering branch:
- file editor pane
- git diff pane
- terminal pane
- browser pane

### 8. Close-tab routing

Update generic `closeDockTab` logic to route `browser:*` tabs to `closeBrowserDock`.

### 9. Fallback active tab behavior

Any logic that computes fallback tab ordering after close must include browser tabs.

Affected areas include close handlers for:
- file tabs
- diff tabs
- terminal tabs
- browser tabs

### 10. Visibility logic

`isEditorDockOpen` currently checks file/diff/terminal tab counts. It should be generalized to include browser tabs as another dockable pane kind.

---

## New UI Entry Point

Phase 1 requires at least one obvious way to open a browser tab.

Recommended initial placement:
- in the Terminal section of `rightBar.tsx`
- button label: `Open Browser`

Behavior:
- opens one new browser tab
- initial URL defaults to configured home page
- activates the browser pane immediately

Optional follow-up:
- context menu entry from links/files
- open selected URL from chat content
- open docs or localhost tool pages in browser pane

---

## Security Requirements

Because this feature loads arbitrary remote content, security constraints matter.

### Phase 1 hard requirements

1. Do not expose app internals into remote pages via preload.
2. Do not enable Node integration for guest content.
3. Only allow `http` and `https` navigation from user-entered addresses.
4. Keep browser state isolated from the main renderer except through explicit pane callbacks.
5. Gracefully handle popup and navigation events.

### Main-window posture already present

`electron/main.ts` currently enables:
- `contextIsolation: true`
- `nodeIntegration: false`
- `webviewTag: true`

This is acceptable for supporting `<webview>`, but the browser pane must avoid broadening exposure further.

### Guest preload

Phase 1 should use no guest preload script.

Reason:
- arbitrary websites do not need access to host APIs
- avoiding preload reduces attack surface

### Protocol handling

Disallow navigating to dangerous protocols from the address bar in phase 1:
- `javascript:`
- `file:`
- `data:`
- custom internal protocols unless explicitly added later

---

## Session and Storage Behavior

### Recommended phase 1 default

Use a shared persistent partition:

```tsx
partition='persist:ygg-browser'
```

This allows:
- logged-in sessions to persist across browser tabs
- standard cookie/session behavior

### Tradeoff

All browser tabs share the same web session.
That is acceptable for phase 1.

### Out of scope for phase 1

- per-tab isolated partitions
- incognito mode
- profile manager

---

## Error Handling

The browser pane should gracefully handle:
- invalid entered URL
- load failures
- unsupported environment
- destroyed/unmounted webview lifecycle timing

### Display rules

- invalid URL: inline small error banner near controls or below header
- load failure: show concise message in the pane header/body
- environment issue: show `Browser pane is only available in Electron`

---

## Persistence

### Phase 1

Browser tabs do not need restore-on-launch persistence.

### Optional phase 1.5

If persistence is added later, follow the terminal dock precedent:
- persist browser tab metadata only
- on launch, restore tabs by URL
- do not attempt to persist full page runtime state beyond what webview session storage already handles

Suggested future storage shape:

```ts
type BrowserDockPreferences = {
  restoreSessionsOnLaunch: boolean
  homeUrl: string
}
```

---

## Styling and Layout Notes

### Layout

The browser pane should match the visual shell used by Monaco and Xterm:
- rounded container
- shared tab strip at top
- header with controls
- content area filling remaining height

### Content area

The webview must fill the pane body completely.

Recommended body layout:
- outer wrapper: `relative min-h-0 flex-1`
- webview: full width/height block element

### Theme

The browser chrome around the webview should respect existing app light/dark styling.
The remote page itself will not automatically follow app theme unless the website supports it.

---

## Implementation Steps

### Step 1: Shared tab type update

Update `MonacoPaneTabItem.kind` to include `'browser'`.

### Step 2: Add `BrowserPane.tsx`

Create a new pane component modeled after `XtermTerminalPane.tsx`.

### Step 3: Add browser state to `rightBar.tsx`

Implement:
- `BrowserDockState`
- `openBrowserTabs`
- active browser resolver
- open/update/close handlers

### Step 4: Add browser tabs to `dockTabs`

Include browser tabs in the shared tab-strip data.

### Step 5: Add browser pane render branch

Render `BrowserPane` when active tab is a browser tab.

### Step 6: Add open-browser button

Expose a simple UI affordance to create a browser tab.

### Step 7: Event/state wiring

Wire webview lifecycle events back into parent state.

### Step 8: Security pass

Confirm:
- no guest preload
- URL normalization blocks unsafe protocols
- failures are handled safely

---

## Acceptance Criteria

1. User can open a browser tab in the right dock.
2. Browser tab appears in the shared dock tab strip.
3. User can open multiple browser tabs.
4. Each browser tab can navigate independently.
5. Back/Forward/Reload work for the active browser tab.
6. Page title updates the tab label.
7. Redirects/navigation update the displayed URL.
8. Browser tabs can be closed without breaking other dock tabs.
9. File/diff/terminal tab behavior remains intact.
10. Feature only runs in Electron and fails gracefully otherwise.
11. No host preload APIs are injected into remote pages.
12. Unsafe protocols from the address bar are rejected.
13. Guest-page DevTools open in detached mode for the embedded page when enabled in Settings.
14. Guest-page DevTools requests are rejected by the main process when disabled in Settings.

---

## Risks and Mitigations

### Risk: React typing and event binding around `<webview>` is awkward

Mitigation:
- isolate webview logic inside `BrowserPane`
- use explicit element refs and imperative event listeners
- add a local TS declaration only if needed

### Risk: popup/new-window behavior is messy

Mitigation:
- in phase 1 either allow popups minimally or redirect them into new browser tabs later
- keep first implementation simple

### Risk: some sites behave poorly inside Electron webview

Mitigation:
- acceptable for phase 1
- support `Open externally` later as fallback

### Risk: dock-close fallback ordering gets more complex

Mitigation:
- centralize remaining-tab calculation if possible
- explicitly include browser tabs in all existing fallback logic

---

## Future Enhancements

1. Open links from chat directly into browser pane.
2. Add `Open externally` button via Electron shell.
3. Add home page setting.
4. Add browser tab persistence.
5. Add download handling.
6. Intercept `window.open` and convert to new in-app browser tabs.
7. Add favicon support.
8. Add lightweight history/search UX.
9. Add permission prompts or allowlists if internal URLs are introduced.
10. Potentially graduate to `WebContentsView` in the future if browser functionality becomes central to the product.

---

## File Change Summary

### New files
- `client/ygg-chat-r/src/components/BrowserPane/BrowserPane.tsx`
- `client/ygg-chat-r/src/helpers/browserSettingsStorage.ts`

### Existing files to modify
- `client/ygg-chat-r/src/containers/rightBar.tsx`
- `client/ygg-chat-r/src/containers/Settings.tsx`
- `client/ygg-chat-r/src/components/MonacoFileEditorPane/MonacoFileEditorPane.tsx`
- `client/ygg-chat-r/src/components/MonacoGitDiffPane/MonacoGitDiffPane.tsx`
- `client/ygg-chat-r/src/components/XtermTerminalPane/XtermTerminalPane.tsx`
- `client/ygg-chat-r/src/components/dockTabStyles.ts`
- `client/ygg-chat-r/src/components/index.ts`
- `client/ygg-chat-r/src/vite-env.d.ts`
- components barrel export file if applicable

### Electron files to modify
- `client/ygg-chat-r/electron/main.ts`
- `client/ygg-chat-r/electron/preload.ts`

Reason:
- `webviewTag: true` is already enabled for embedding
- guest-page DevTools require preload-to-main IPC
- DevTools availability is stored in app settings and enforced in the main process

---

## Final Recommendation

Proceed with an Electron-only `BrowserPane` using `<webview>` embedded inside the existing right-bar dock system.

This approach is the best balance of:
- real browsing capability
- low architectural disruption
- reuse of current dock/tab patterns
- controlled implementation scope

It should be treated as a new dockable pane type parallel to:
- Monaco file editor
- Monaco diff viewer
- Xterm terminal
