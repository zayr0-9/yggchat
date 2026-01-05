# TODO List Utility: `server/src/utils/tools/core/todoList.ts`

This utility provides file-backed TODO storage for the CLI/agents in the repository. It keeps markdown-based TODO items under a directory that is easy to locate and sandbox for local workflows.

## Configuration & storage location

- `YGG_TODO_DIRECTORY` (optional): if set, the utility resolves the provided path and uses it as the root directory for TODO storage.
- When the environment variable is not provided, the utility defaults to `${process.cwd()}/.ygg-chat-todos`.
- Inside the root directory, all TODO files live in a `todos/` subfolder and use the `.md` extension.

## Key constants

- `TODO_FOLDER_NAME`: `todos`, the subfolder under the base directory.
- `TODO_FILE_EXTENSION`: `.md`, meaning each TODO is a Markdown document.
- `ID_DICTIONARY`: a curated list of friendly words used by the random ID generator.
- `MAX_ID_ATTEMPTS`: 12 attempts to find a unique ID before failing.

## Helper functions

- `resolveBaseDirectory()`: returns the root storage directory by checking `YGG_TODO_DIRECTORY`; if not set, it defaults to `${process.cwd()}/.ygg-chat-todos`.
- `getTodoDirectory()`: constructs the final directory path by joining the base directory with `todos/`.
- `normalizeId(raw)`: trims and lowercases an ID, ensuring it only contains `[a-z0-9-]` characters and neither starts nor ends with a dash. Throws an error if the ID violates the rules.
- `ensureDirectoryExists()`: creates the `todos/` directory recursively and returns its path.

## API

### `listTodoIds(): Promise<string[]>`
Reads the `todos/` directory and returns all filenames without the `.md` extension. If the directory does not exist, it safely returns an empty list.

### `readTodoList(id: string): Promise<ReadTodoResult>`
- Sanitizes the given `id` through `normalizeId`.
- Builds the file path `todos/{id}.md`.
- Attempts to `readFile` the content and returns `{ id, path, exists: true, content }` on success.
- If the file is missing (`ENOENT`), returns `{ id, path, exists: false, content: null }`, allowing callers to distinguish missing files from other errors.

### `writeTodoList(id: string, content: string): Promise<WriteTodoResult>`
- Sanitizes the ID, ensures the directory exists, and writes the provided content as UTF-8.
- Constructs the path `todos/{id}.md` and writes the data.
- Returns `{ id, path }` for reference.

### `generateTodoId(): Promise<string>`
- Fetches existing IDs to avoid collisions.
- Uses `unique-names-generator` to create a three-word, lowercase, dash-separated ID from `ID_DICTIONARY`.
- Makes up to `MAX_ID_ATTEMPTS` attempts to find an unused ID.
- If no unique candidate is found, throws an error.

### `getTodoStorageDirectory(): string`
Convenience helper that exposes the resolved `todos/` directory for callers that need to know where files are stored without manipulating paths.

## Usage notes

- File names follow the pattern `{id}.md`, and IDs must be dash-separated, lowercase strings with no invalid characters.
- `normalizeId` enforces consistent validation for reads and writes.
- For new TODOs, use `generateTodoId()` to avoid collisions before calling `writeTodoList`.
- The utility is intentionally filesystem-based, so it remains isolated from databases; storing data under `.ygg-chat-todos` keeps it local to the repo and easy to clean.
