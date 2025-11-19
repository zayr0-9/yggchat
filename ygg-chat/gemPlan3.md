# Removal of Web/SaaS Components for Desktop Release

This plan outlines the steps to remove server-side components that are specific to the SaaS/Web deployment (Supabase, Stripe, Billing, Credits) from the desktop Electron release. The desktop app is designed to be self-contained or connect to a remote "host" for AI processing, rather than managing its own billing and user accounts locally.

## Objective
Remove unused files and dependencies from the server build to reduce bundle size, complexity, and potential security risks in the desktop application.

## Targeted Files for Removal
The following files are identified as Web/SaaS specific and should be excluded or shimmed:

1.  `server/src/database/supamodels.ts` (Supabase models & client)
2.  `server/src/routes/supaChat.ts` (Supabase-backed chat routes)
3.  `server/src/utils/stripe.ts` (Stripe integration)
4.  `server/src/routes/stripe.ts` (Stripe routes)
5.  `server/src/utils/CCSupabase.ts` (Claude Code Supabase integration)
6.  `server/src/utils/openai.ts` (Direct OpenAI usage - likely replaced by openrouter or provider abstraction, but if used only for SaaS, remove)
7.  `server/src/utils/openrouter.ts` (OpenRouter specific logic with credits/billing)
8.  `server/src/utils/supaAttachments.ts` (Supabase Storage attachments)
9.  `server/src/utils/provider.ts` (Provider abstraction - *Check if this is used by local chat*)
10. `server/src/workers/openrouter-reconciliation.ts` (Credit reconciliation worker)

## Strategy: Exclude via Build Config vs. Delete

Since the codebase might still be used for the Web deployment (dual-purpose repo), we should **exclude** these files from the Electron build rather than deleting them from the source tree.

### 1. `server/tsconfig.json` Modification (or `tsconfig.electron.json`)
Create a specific TypeScript configuration for the Electron server build that excludes these files. However, simply excluding them might cause compilation errors if other files import them.

**Better Approach:**
We will create a separate entry point for the Electron server (`server/src/index.electron.ts`) that **only imports what is needed** for the desktop app (local DB, local chat routes, tools).

### 2. Refactoring `index.ts`
Currently, `server/src/index.ts` conditionally loads routes based on `VITE_ENVIRONMENT`.
```typescript
if (env.VITE_ENVIRONMENT === 'web') {
  const supaChat = require('./routes/supaChat').default
  app.use('/api', supaChat)
  // ...
} else {
  app.use('/api', chatRoutes) // Local chat routes
}
```
This dynamic `require` is good, but `tsc` compiles everything referenced in the project unless specifically excluded.

### 3. Execution Plan

1.  **Audit Dependencies**: Check if `chatRoutes` (used for Electron) imports any of the targeted files.
    *   `server/src/routes/chat.ts` likely uses `models.ts` (SQLite) instead of `supamodels.ts`.
    *   If `chat.ts` is clean, we are good.

2.  **Modify `build:server` Script**:
    Instead of just running `tsc`, we can use a dedicated tsconfig or ensuring the build process treeshakes unused code if we were using a bundler.
    Since we are using `tsc`, it outputs individual files. We can simply **delete** the unwanted files from the `dist/` folder *after* compilation but *before* packaging.

    **Why?** `tsc` might still compile them if they are in the source tree. But if `index.js` (compiled) has dynamic requires, removing the files from `dist/` ensures they aren't packaged.

3.  **Clean-up Script**:
    Create a script `scripts/clean-server-dist.js` (or inline command) to remove specific files from `server/dist` after `npm run build:server`.

    **Files to Remove from `dist/`**:
    *   `server/src/database/supamodels.js`
    *   `server/src/routes/supaChat.js`
    *   `server/src/routes/stripe.js`
    *   `server/src/utils/stripe.js`
    *   `server/src/utils/CCSupabase.js`
    *   `server/src/utils/supaAttachments.js`
    *   `server/src/workers/openrouter-reconciliation.js`
    *   `server/src/utils/openrouter.js` (Careful: check if local chat uses this for direct key usage without credits)
    *   `server/src/utils/provider.js` (Careful: check usage)

    *Self-Correction*: `provider.ts` and `openrouter.ts` might be used by the local chat if the user provides their own API key. The request says "all user prompts go to the railway server which holds api key".
    If the desktop app sends prompts to the **Railway Server**, then the local server **should not** have `openrouter.ts` logic if it's not doing the generation locally.
    *However*, the desktop app usually connects *directly* to the Railway URL for chat, skipping the local server entirely for those requests.
    The local server is for "db CRUD and tool calls".

4.  **Verify `chat.ts` imports**:
    Ensure `server/src/routes/chat.ts` doesn't import `provider.ts` or `openrouter.ts` if we are deleting them.

5.  **Implementation Steps**:
    *   **Step 1**: Verify `server/src/routes/chat.ts` dependencies.
    *   **Step 2**: Create a `cleanup_dist.js` script in `server/scripts/`.
    *   **Step 3**: Update `client/ygg-chat-r/package.json` -> `build:server` to run this cleanup script after build.

## Files to Audit for Dependencies
*   `server/src/routes/chat.ts`
*   `server/src/index.ts` (The `require` calls will fail if files are missing, so we must ensure `VITE_ENVIRONMENT` is NOT 'web' in the packaged app, which `electron/main.ts` ensures).

**Constraint Check**: `server/src/index.ts` has static imports?
No, `index.ts` uses `require()` inside `if (env.VITE_ENVIRONMENT === 'web')`. This is safe.
However, `import { startReconciliationWorker } from './workers/openrouter-reconciliation'` is at the top level?
Let's check `server/src/index.ts` again.

**Correction**:
If `import { ... } from ...` is at the top level, Node.js will try to resolve it at startup, even if the usage is guarded.
We need to convert top-level imports of these "web-only" modules to dynamic `require()` or `import()` calls inside the `if ('web')` blocks in `server/src/index.ts`.

## Detailed Plan

1.  **Refactor `server/src/index.ts`**:
    *   Remove top-level static imports for:
        *   `./workers/openrouter-reconciliation`
    *   Move them inside the `if (env.VITE_ENVIRONMENT === 'web')` block using `require` or `await import`.

2.  **Refactor `server/src/routes/chat.ts`** (if necessary):
    *   Ensure it doesn't import `supamodels` or other web-only utils.

3.  **Create Cleanup Script**:
    *   `server/scripts/cleanup-dist.js`: Deletes the targeted `.js` and `.d.ts` files from `dist/`.

4.  **Update Build Command**:
    *   Update `client/ygg-chat-r/package.json` to run the cleanup.

This ensures that when `VITE_ENVIRONMENT` is 'electron', the code never attempts to load the missing files, and the files themselves are physically removed from the package.
