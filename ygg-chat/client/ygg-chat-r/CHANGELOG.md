# Changelog

All notable changes to `client/ygg-chat-r` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

### Changed

### Fixed

## [0.1.79] - 2026-02-23

### Added

- auto summarisation added
- solid background support
- custom font support
- sidebar shows messages in each chat in popover list

### Changed

- sidebar makeover
- edit file optimised
- cwd change sent as user message

### Fixed

- fixed readme build instructions
- textfiled font size is now smaller when branching
- Html Tools modal now shows app names in Favorites and Hibernated lists (in addition to IDs), matching opened app visibility in the top tabs.
- create new chat carries over cwd now.

## [0.1.78] - 2026-02-23

### Added

- new tool runtime (isolated in an electron utility worker now instead of main render thread) [if building yourself: in client/.env add YGG_TOOLS_RUNTIME=utility and DISABLE_TOOL_RUNTIME_FALLBACK=true if you dont fall back]

### Changed

- Moved settings button to sidebar for easier access.
- updated permission modal design.
- removed to do list tool call ui from chatMessage.
- less x padding in chat input.

### Fixed

- made branch switching a lot more efficient.
- chat page is a lot snappier.
- can clear selected context with clear button.

## [0.1.77] - 2026-02-22

### Added

- Added delete confirmation modal when message is deleted from heimdall tree.

### Changed

- Updated sidebar design, rounded corners, centered buttons.
- searchbar in heimdall on open autofocuses now.

### Fixed

- Fixed z axis overlaps on chat page
- Fixed agent tool call grouping leaking (its very laggy not ready for use thus disabled by default)
- Fixed openai reasoning accumulation while streaming

## [0.1.76] - 2026-02-14

### Added

- Added a right-dock mode toggle to the HTML Tools modal so the app viewer can switch between full-screen overlay and a right-side panel.
- Added a draggable dock separator for the right-docked HTML Tools modal, including persistent live resize behavior.

### Changed

- Right-docked HTML Tools modal now uses a solid panel style (no backdrop blur), with improved separator affordance and a dedicated left grab gutter.
- Docked modal width bounds now allow shrinking down to 30% of viewport width.
- Header controls in docked mode now collapse to icon-only actions at narrow widths to prevent overflow.

### Fixed

- Fixed iframe-adjacent resize “stuck drag” behavior by introducing iframe-safe drag shields during active resize interactions.
- Applied the resize drag fix in both split panes:
  - Chat view (Heimdall separator in `Chat.tsx`)
  - HTML Tools docked modal separator (`HtmlToolsModal.tsx`)

## [0.1.75] - 2026-02-14

### Added

- Reworked the sidebar’s Projects view to feel like a dedicated workspace: the most-recent project expands by default, project summaries now show a “last activity” date even for local projects, and expanding a project fetches its conversations lazily.
- Added hover-only add/delete controls next to every project/conversation, letting you spin up a new chat or cleanly delete a project/conversation with cache health maintained behind the scenes (Redux + React Query updates + navigation when the active chat vanishes).
- Creating a conversation from the sidebar now immediately navigates into the new chat and refreshes the project order without waiting for the next network fetch.
- Can set default startup page to be homepage or latest chat.
- floating title bar in chat page now hides itself.
- Added a new Chat Settings toggle to group continuous reasoning/tool-call chains (`chat:groupToolReasoningRuns`), with local persistence and live sync via custom/storage events.
- Added search bar in SideBar, can search for any chat title, search is pretty lenient in pattern matching.
- logs store in app dir under /logs in ndjson file.

### Fixed

- Navigating between conversations with empty histories now clears the previous messages view so stale content is not shown.

### Changed

- Chat message rendering can now optionally collapse long contiguous reasoning + tool sequences into a single `Agent Steps (N)` collapsible section.
- The optional grouping behavior is applied consistently to both live streaming (`streamEvents`) and persisted history rendering (`contentBlocks`).
- Chat conversation title editor top bar now auto-hides while scrolling down through messages and reappears when scrolling back up, with smooth transition animations and adaptive message-list top padding.
- Sidebar now always opens on the Projects tab and the previous per-user default-tab preference in Settings has been removed, reinforcing a single consistent entry point.

## [0.1.74] - 2026-02-13

### Changed

### Fixed

- IDE file mention dropdowns from branch edits no longer render underneath adjacent virtualized message rows (stacking contexts) when extension-driven file lists are visible.
- IDE context was not clearing.

## [0.1.73] - 2026-02-13

### Fixed

- Extension when run in wsl was not connecting to app running under windows, it works now.

## [0.1.73] - 2026-02-12

### Added

- **OpenRouter Temperature Setting**: Provider Settings now include an `OpenRouter Temperature` field with local persistence, allowing fine-grained control over response randomness for OpenRouter models.
- **Default Bash Timeout Configuration**: Tools Configuration now includes a configurable default bash timeout setting that applies to tool runs that do not explicitly specify a `timeoutMs` value.
- **Graceful Agent Queue Handling**: Global agent queues now properly wait for the current stream to complete before processing the next request, preventing race conditions and ensuring smooth sequential execution.
- **Chat Reasoning Defaults** (Settings page): Users can now configure default thinking behavior and reasoning effort level (`low`/`medium`/`high`/`xhigh`) for supported models. These preferences persist locally and are automatically applied in Chat when the selected model supports extended thinking. Models without reasoning support will have thinking forced off regardless of the default setting.
- **GPT Account Logout**: Users can now properly log out of their GPT account, with session data and authentication tokens securely cleared.
- **Codex 5.3 Integration**: Full support for Codex 5.3 has been added, including all latest features and capabilities.
- **Notes pill and branch labeling**: Heimdall note pills now show a truncated preview of the note text, adopt a blue pill background with white text in light mode, and open a hover popup mirroring the note’s full content.
- **5.1 Codex mini**: Support added, small fast model good for small changes (write my commit browse the web etc).
- **IDE context visibility**: Added an “ide context detected” pill with a hover preview (including dark-mode styling) whenever the extension reports a selected-range; it surfaces filename/path/lines alongside the file mention dropdown.
- **Context-aware sends & branches**: Appended IDE context metadata (file path/name/line range) to every outgoing user message, including CC sends, message sends, branch submissions, and explain-from-selection flows so the model sees which file/selection the user referenced.
- **Branch coverage**: Ensured IDE-context metadata now flows through branching helpers (`sendCCBranch`, `editMessageWithBranching`, etc.) so all follow-up messages carry the inferred file context.
- **Extension 1.0.5: Folder mention support**: Added folder entries alongside files in the IDE @ picker, including explicit folder vs file metadata, directory-aware filtering, and mention insertion without fetching file contents so you can reference folder paths by name.
- **Extension 1.0.5 Port discovery resilience**: Extension now scans 3002–3015 (plus persistent host tracking) and prefers loopback, matching the Electron app’s dynamic port handling.
- **Changelog in settings**: Can read latest changelog in settings page.

### Fixed

- Bash tool workspace path validation now correctly accepts equivalent root paths (for example, trailing-slash variants) and handles `cwd` values like `.` consistently.

## [0.1.72] - 2026-02-12

### Changed

- Global Agent has a scheduler, per second/min/day granular control for repeated prompts or tasks.
- Global Agent scheduler modal now overlays the full right sidebar so it no longer appears behind the file list.
- After sending a message, the scheduler `Enable Schedule` toggle is automatically turned off.
- Work directory for Global Agent can now be set from app settings.
- Task manager button now says “Apps” instead of “Tools”.

## [0.1.71] - 2026-02-12

### Added

- Added a structured changelog workflow for Electron desktop releases.

### Changed

- Release automation now supports publishing changelog notes with each tagged version.
