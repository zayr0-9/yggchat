# Changelog

All notable changes to `client/ygg-chat-r` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- _No notable changes yet._

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
