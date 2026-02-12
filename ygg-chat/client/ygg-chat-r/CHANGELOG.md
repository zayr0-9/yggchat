# Changelog

All notable changes to the Electron app are documented in this file.

The format follows Keep a Changelog, and versions map to `client/ygg-chat-r/package.json`.

## [0.1.72] - 2026-02-12

### Changed

- Global Agent has a scheduler, per second/min/day granular control for repeated prompts or tasks
- Global Agent scheduler modal now overlays the full right sidebar so it no longer appears behind the file list.
- After sending a message, the scheduler `Enable Schedule` toggle is automatically turned off.
- Work directory for global agent can now be set from app settings
- Task manager button just says Apps now instead of tools like before

## [0.1.71] - 2026-02-12

### Added

- Added a structured changelog workflow for Electron desktop releases.

### Changed

- Release automation now supports publishing changelog notes with each tagged version.
