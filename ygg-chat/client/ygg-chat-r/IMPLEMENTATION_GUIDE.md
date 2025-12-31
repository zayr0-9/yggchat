# Floating Window Feature - Implementation Guide

## Overview

This feature adds a floating popup window capability to the Electron app, similar to picture-in-picture windows in browsers. The floating window stays on top of all other applications and can be toggled on/off.

## Files Modified/Created

### 1. Backend (Electron)

**`electron/main.ts`**
- Added `floatingWindow` variable to track floating window instance
- Added `createFloatingWindow()` function to create a floating popup window
- Added `toggleFloatingWindow()` function to toggle the floating window on/off
- Added IPC handlers:
  - `window:openFloating` - Open the floating window
  - `window:closeFloating` - Close the floating window
  - `window:toggleFloating` - Toggle the floating window
  - `window:isFloatingOpen` - Check if floating window is open

**Key features of the floating window:**
- `alwaysOnTop: true` - Always stays above other windows
- `transparent: true` - Transparent background for better aesthetics
- `frame: false` - No title bar for cleaner look
- `setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })` - Visible in fullscreen apps
- `setAlwaysOnTop(true, 'floating', 1)` - Higher z-index for better visibility
- `setFullScreenable(false)` - Can't be made fullscreen (keeps as popup)

### 2. Preload Script

**`electron/preload.mjs`**
- Added floating window controls to the `window` object in electronAPI:
  - `openFloating()` - Opens floating window
  - `closeFloating()` - Closes floating window
  - `toggleFloating()` - Toggles floating window
  - `isFloatingOpen()` - Checks if floating window is open

### 3. TypeScript Definitions

**`src/vite-env.d.ts`**
- Updated ElectronAPI interface to include floating window controls

### 4. React Hook

**`src/hooks/useFloatingWindow.ts`**
- Custom React hook to manage floating window state
- Provides:
  - `isOpen` - Boolean indicating if floating window is open
  - `isLoading` - Boolean for loading state
  - `error` - Error message if operation failed
  - `openFloatingWindow()` - Open the floating window
  - `closeFloatingWindow()` - Close the floating window
  - `toggleFloatingWindow()` - Toggle the floating window

### 5. React Component

**`src/components/FloatingWindowButton/FloatingWindowButton.tsx`**
- A floating button component to toggle the floating window
- Features:
  - Fixed positioning (configurable)
  - Shows/hides based on window state
  - Loading state indicator
  - Only shows in Electron (auto-hidden in web)
  - Blue colored button with hover effects
  - Accessible with proper ARIA labels

**`src/components/index.ts`**
- Exported `FloatingWindowButton` component

## Usage Examples

### Example 1: Add Floating Window Toggle to Any Page

```tsx
import { FloatingWindowButton } from '../components'
// Or import from index: import { FloatingWindowButton } from '../components'

function ChatPage() {
  return (
    <div className="relative">
      {/* Your existing content */}
      <ChatMessages />
      <InputArea />

      {/* Add floating window button */}
      <FloatingWindowButton />
    </div>
  )
}
```

### Example 2: Use the Hook Directly

```tsx
import { useFloatingWindow } from '../hooks/useFloatingWindow'

function CustomControls() {
  const { isOpen, isLoading, toggleFloatingWindow } = useFloatingWindow()

  return (
    <div>
      <button
        onClick={toggleFloatingWindow}
        disabled={isLoading}
      >
        {isOpen ? 'Close Floating Window' : 'Open Floating Window'}
      </button>
    </div>
  )
}
```

### Example 3: Custom Positioned Button

```tsx
<FloatingWindowButton 
  position="top-left" 
  className="mt-20" 
/>
```

## Available Props for FloatingWindowButton

| Prop | Type | Default | Description |
|------|------|----------|-------------|
| `className` | `string` | `''` | Additional CSS classes |
| `position` | `'top-right' \| 'top-left' \| 'bottom-right' \| 'bottom-left'` | `'bottom-right'` | Fixed position on screen |

## Platform-Specific Behavior

### macOS
- Works with macOS fullscreen apps
- May require permission for accessibility in some cases
- Integrates well with macOS window management

### Windows
- Works with fullscreen apps and games
- Integrates with taskbar (shows in taskbar)
- Respects Windows desktop composition

### Linux
- Works with most window managers
- May behave differently based on desktop environment (GNOME, KDE, etc.)

## Testing

1. Build the Electron app:
   ```bash
   npm run build:electron
   ```

2. Run in development mode:
   ```bash
   npm run dev:electron
   ```

3. Add `<FloatingWindowButton />` to any page
4. Click the button to open floating window
5. Verify:
   - Window opens as a small popup
   - Window stays on top of other apps
   - Clicking the button again closes the window
   - Button doesn't appear in web mode

## Customization

### Change Floating Window Size

Edit `createFloatingWindow()` in `electron/main.ts`:

```typescript
floatingWindow = new BrowserWindow({
  width: 600,    // Change width
  height: 400,   // Change height
  minWidth: 300,
  minHeight: 200,
  // ... other options
})
```

### Change Window Appearance

```typescript
floatingWindow = new BrowserWindow({
  transparent: true,    // Enable transparency
  backgroundColor: '#00ffffff', // Fully transparent background
  opacity: 0.95,       // Slight opacity for overlay effect
  // ... other options
})
```

### Add Draggable Region

The floating window can be made draggable by adding CSS in your renderer:

```css
/* Add to your CSS */
.floating-window-drag-region {
  -webkit-app-region: drag;
}
```

## Troubleshooting

### Floating window doesn't appear over fullscreen apps

**macOS:**
- Make sure you have proper permissions
- Try adding: `floatingWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })`

**Windows:**
- Ensure you're using the 'floating' level: `setAlwaysOnTop(true, 'floating', 1)`

### Floating window closes unexpectedly

- Check if the main window is being closed
- Verify that `floatingWindow` reference is being maintained
- Check console logs for errors

### Button appears in web mode

The component automatically hides if `window.electronAPI` is undefined. If it still appears, verify your build configuration.

## Future Enhancements

Potential improvements:
1. Add window resizing from edge
2. Add minimize to tray functionality
3. Add window position persistence
4. Add custom themes for floating window
5. Add multiple floating windows support
6. Add window snapping to screen edges
7. Add keyboard shortcuts for window control

## Notes

- The floating window loads the same content as the main window
- You may want to create a separate route/URL for the floating window to show simplified UI
- The floating window shares session state with the main window
- Consider adding a "compact mode" for the floating window to show minimal interface
