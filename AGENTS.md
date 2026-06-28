# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Commands

```bash
pnpm dev                  # Start Vite dev server (127.0.0.1:8888)
pnpm dev:companion        # Start Companion CLI server (127.0.0.1:19750)
pnpm dev:desktop          # Start Tauri dev shell (webview + hot reload; needs Rust)
pnpm build                # Production build to dist/
pnpm build:desktop        # Build desktop app to .app/.dmg (needs Rust)
pnpm preview              # Preview production build
pnpm typecheck            # Type-check web app with vue-tsc --noEmit
pnpm typecheck:companion  # Type-check companion with tsc --noEmit
pnpm test                 # Run Vitest tests (all)
pnpm test:watch           # Run Vitest in watch mode
```

Run a single test file: `pnpm vitest run src/services/backups.test.ts`

No linter or formatter is configured. Vitest is configured for service-level tests.

## Architecture

Local-first AI image creation workbench. Vue 3 + Composition API (`<script setup>`), no router. Only runtime dependency beyond Vue is Pinia for state management. ZIP creation/reading, base64 conversion, image dimension reading, storage usage estimation, and analytics export are project-owned code rather than large app-level helper libraries.

See `docs/README.md` for the maintained documentation map and `docs/architecture.md` for the current architecture direction.

### State Management

Pinia stores in `src/stores/` manage cross-component shared state by domain (`settingsStore`, `composerStore`, `imagesStore`, `conversationsStore`, `generationStore`, `analyticsStore`, `feedbackStore`).

`src/app/studio/useStudioViewModel.ts` is the page-level orchestration layer: it coordinates across stores for workflows like draft switching, backup/restore, and preview. `App.vue` calls it once and distributes state/methods to children via props and events.

Feature composables in `src/features/*/` serve as compatibility wrappers bridging the old composable API to the new Pinia stores.

**Hydration**: On mount, stores load all data from IndexedDB into memory refs. All subsequent mutations happen in memory first, then async-persist to IndexedDB via the `services/` layer.

**Dual storage**: Lightweight drafts (`composerText`, `attachedImages`, API config) go to localStorage. Everything else (conversations, messages, image assets, image blobs, settings) goes to IndexedDB.

**Analytics**: Local-first event logging is optional product telemetry stored locally in IndexedDB, exported as ZIP/JSONL/Markdown reports, and intentionally excluded from normal project backups.

### Data Flow

```
User action → Component emit → App.vue handler → useStudioViewModel method
  → Pinia store action (reactive UI update) → async persist to services/ → IndexedDB
```

### Component Organization

```
src/components/
  studio/       # Page-level layout shells (ChatWorkspace, ConversationSidebar, ImageLibrary, modals)
  chat/         # Chat composer, message list, parameter bar, mask editor
  image-library/# Image grid, card, details panel, storage usage
  settings/     # API config, backup, batch operations panels
  ui/           # Generic reusable: Tooltip, ConfirmDialog, NoticeToast, RenameDialog
```

### Desktop Shell

The desktop app lives under `desktop/src-tauri` and is a Tauri v2 shell that embeds the existing Vite `dist/` output. Keep the browser/Web app behavior as the source of truth. The desktop shell currently connects to the external Companion over `127.0.0.1`; do not assume Companion is bundled as a sidecar yet.

### Service Layer (`src/services/`)

All IndexedDB access goes through `db.ts` (generic CRUD: `getAllFromStore`, `getFromStore`, `putInStore`, `deleteFromStore`). Domain services build on top:

| File | Purpose |
|------|---------|
| `conversations.ts` | List/save/delete conversations |
| `messages.ts` | List/save/delete messages |
| `imageAssets.ts` | Image metadata + blob CRUD (separate stores) |
| `settings.ts` | Single-record app settings |
| `imagesApi.ts` | Browser direct image generation/editing calls, including Images API and Responses API streaming paths |
| `companionApi.ts` | Browser-to-local Companion health, pairing, auth, and image proxy calls |
| `conversationDrafts.ts` | Per-conversation draft persistence (localStorage) |
| `generationParams.ts` | Generation parameter validation and defaults |
| `promptBuilder.ts` | Prompt mode wrapping before requests while preserving raw chat prompt text |
| `favoritePrompts.ts` | Favorite prompt persistence |
| `promptWordbanks.ts` | Prompt mode wordbank helpers |
| `analyticsEvents.ts` | Local analytics event persistence |
| `analyticsExport.ts` | Analytics ZIP/JSONL/Markdown export |
| `imageMetadata.ts` | Read image dimensions via `createImageBitmap` / `HTMLImageElement` |
| `storageUsage.ts` | Estimate IndexedDB usage via `navigator.storage.estimate()` |
| `backups.ts` | Full project export/import as ZIP |
| `zipArchive.ts` | Hand-written ZIP file creator (CRC32 + binary format) |

### Generation / Image Client

`src/features/generation/imageClients/imageClient.ts` defines the `ImageClient` interface (`generate` + `edit`). Two implementations:
- `directImagesClient` — browser calls user-configured OpenAI-compatible Images API directly.
- `localCompanionImagesClient` — browser calls a paired local companion service on `127.0.0.1`.

Browser direct mode can use Images API or Responses API depending on settings. Responses API streaming partial images are runtime-only previews and are not persisted until the final image result is stored through the normal image asset flow. Companion mode is currently Images-API-only from the Web app's point of view.

### Companion Provider Layer

`companion/src/providers/` contains provider adapters behind a registry. Current adapters include OpenAI-compatible, GLM, Doubao/Volcano Ark Seedream, Qwen-Image, and Wan providers. The Web app should stay capability-driven: provider-specific validation, size translation, task polling, multipart handling, DashScope response parsing, and URL-to-base64 conversion belong in Companion provider modules unless the UI needs a generic capability signal.

Companion security boundaries still matter:
- Listen on `127.0.0.1`, not `0.0.0.0`.
- Require pairing/session auth for protected routes.
- Keep credential storage inside Companion; the Web app must not read or export Companion secrets.
- Keep logs free of authorization headers, full prompts, uploaded image data, and base64 payloads.

### Types

All business types in `src/types/studio.ts`: `Conversation`, `Message`, `ImageAsset`, `GenerationParams`, `AppSettings`, plus union type aliases.
Companion-facing browser types live in `src/types/companion.ts`; server-side Companion types live under `companion/src/types.ts` and provider-specific type modules.

### Key Patterns

- **Image storage**: Metadata (`imageAssets` store) and binary data (`imageBlobs` store) are separated. `ImageAsset.blobKey` links them. `previewUrl` (`URL.createObjectURL`) is memory-only — created during hydration, stripped before persist via `toPlainImageAsset`.
- **Generation job flow**: `generationStore` manages the full lifecycle: create user + assistant messages → persist → dispatch to `ImageClient.generate` or `ImageClient.edit` based on whether reference images are attached → on success create `ImageAsset` + blob → on failure mark assistant message as `error`.
- **Conversation write queue**: A promise chain serializes conversation writes to prevent race conditions from rapid sequential operations.
- **Prompt modes**: `promptBuilder.ts` wraps prompts only at request time. Chat history should keep the user's raw prompt, not the expanded provider prompt.
- **Analytics tracking**: Prefer module-level tracker helpers and `v-track` for UI events. Do not put analytics events into backup exports.
- **Parameter editors**: Collapsible inline editors in ChatWorkspace using `grid-template-rows` CSS transition for animation. Scoped `<style>` is only used for this animation.

### Styling

Tailwind CSS v4 via `@tailwindcss/vite` plugin (no config file). Single CSS entry `@import "tailwindcss"` in `src/style.css`. All styling via utility classes except the one scoped animation.

### API Integration

OpenAI-compatible Images API. Generation: `POST {apiBaseUrl}/generations` (JSON). Editing: `POST {apiBaseUrl}/edits` (multipart/form-data with `image[]` array). Response expects `{ data: [{ b64_json }] }`. Browser direct mode also supports Responses API streaming previews when `apiMode` is configured for it; Companion mode stays on the Images API compatibility surface.

Custom size validation for the generic Web UI remains conservative: 16-3840px, multiples of 16, aspect ratio ≤ 3:1, total pixels 655,360-8,294,400. Provider-specific constraints should be modeled as capabilities, especially for Companion providers that expose different resolution tiers or pixel minimums.

## Roadmap

See `docs/roadmap.md` for the full roadmap. Current status:
- Phases 1-4: Done (chat UI, IndexedDB persistence, text-to-image, image editing with references)
- Phase 5: Experience enhancements — core items done
- Done: Settings refactor with batch operations (`docs/archive/settings-batch-operations-plan.md`)
- Done: Generation jobs (`src/stores/generationStore.ts`), per-conversation drafts (`src/services/conversationDrafts.ts`), mask editing (`docs/mask-editing.md`)
- Done: Local analytics V1.0-V1.2 (`src/stores/analyticsStore.ts`, `src/services/analyticsEvents.ts`, `src/services/analyticsExport.ts`); analytics is local-only and excluded from backups
- Done: Prompt modes (`src/services/promptBuilder.ts`, `docs/prompt-modes.md`)
- Done: Responses API streaming image previews for browser direct mode (`docs/responses-streaming-plan.md`)
- Done: Local CLI Companion background service management (`start`/`stop`/`restart`/`logs`) with first-pairing wait flow; system keychain is deferred
- Done: Companion provider translation layer with OpenAI-compatible, GLM, Doubao/Seedream, Qwen-Image, and Wan providers (`docs/companion-providers-plan.md`, `docs/companion-doubao-plan.md`)
- Done: Tauri v2 desktop packaging first version (`desktop/src-tauri`, `docs/desktop-packaging.md`)
- Upcoming: finer image-library filters, desktop signing/notarization/cross-platform builds/updater, optional Companion sidecar, analytics V2 analysis layer

## Conventions

- Commit messages follow Conventional Commits (`feat:`, `fix:`, `chore:`, `refactor:`, `docs:`, `ci:`)
- UI language is Chinese
- Package manager is pnpm (specified in `package.json` `packageManager` field)
- Branch: develop on `honlnk/dev`, PR to `main`
- Deploy: GitHub Pages via GitHub Actions on push to `main`
