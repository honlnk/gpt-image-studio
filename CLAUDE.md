# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm dev                  # Start Vite dev server (127.0.0.1:8888)
pnpm dev:companion        # Start Companion CLI server (127.0.0.1:19750)
pnpm build                # Production build to dist/
pnpm preview              # Preview production build
pnpm typecheck            # Type-check web app with vue-tsc --noEmit
pnpm typecheck:companion  # Type-check companion with tsc --noEmit
pnpm test                 # Run Vitest tests (all)
pnpm test:watch           # Run Vitest in watch mode
```

Run a single test file: `pnpm vitest run src/services/backups.test.ts`

No linter or formatter is configured. Vitest is configured for service-level tests.

## Architecture

Local-first AI image creation workbench. Vue 3 + Composition API (`<script setup>`), no router. Only runtime dependency beyond Vue is Pinia for state management. ZIP creation/reading, base64 conversion, image dimension reading, and storage usage estimation are all hand-written (no external libs).

See `docs/README.md` for the maintained documentation map and `docs/architecture.md` for the current architecture direction.

### State Management

Pinia stores in `src/stores/` manage cross-component shared state by domain (`settingsStore`, `composerStore`, `imagesStore`, `conversationsStore`, `generationStore`, `feedbackStore`, `analyticsStore`).

`src/app/studio/useStudioViewModel.ts` is the page-level orchestration layer: it coordinates across stores for workflows like draft switching, backup/restore, and preview. `App.vue` calls it once and distributes state/methods to children via props and events.

Feature composables in `src/features/*/` serve as compatibility wrappers bridging the old composable API to the new Pinia stores.

**Hydration**: On mount, stores load all data from IndexedDB into memory refs. All subsequent mutations happen in memory first, then async-persist to IndexedDB via the `services/` layer.

**Dual storage**: Lightweight drafts (`composerText`, `attachedImages`, API config) go to localStorage. Everything else (conversations, messages, image assets, image blobs, settings) goes to IndexedDB.

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

### Service Layer (`src/services/`)

All IndexedDB access goes through `db.ts` (generic CRUD: `getAllFromStore`, `getFromStore`, `putInStore`, `deleteFromStore`). Domain services build on top:

| File | Purpose |
|------|---------|
| `conversations.ts` | List/save/delete conversations |
| `messages.ts` | List/save/delete messages |
| `imageAssets.ts` | Image metadata + blob CRUD (separate stores) |
| `settings.ts` | Single-record app settings |
| `imagesApi.ts` | OpenAI-compatible image generation (`/generations`) and editing (`/edits`) API calls |
| `conversationDrafts.ts` | Per-conversation draft persistence (localStorage) |
| `generationParams.ts` | Generation parameter validation and defaults |
| `imageMetadata.ts` | Read image dimensions via `createImageBitmap` / `HTMLImageElement` |
| `storageUsage.ts` | Estimate IndexedDB usage via `navigator.storage.estimate()` |
| `backups.ts` | Full project export/import as ZIP |
| `analyticsEvents.ts` | Analytics event persistence + JSONL export (excluded from backups) |
| `zipArchive.ts` | Hand-written ZIP file creator (CRC32 + binary format) |

### Generation / Image Client

`src/features/generation/imageClients/imageClient.ts` defines the `ImageClient` interface (`generate` + `edit`). Two implementations:
- `directImagesClient` — browser calls user-configured OpenAI-compatible Images API directly.
- `localCompanionImagesClient` — browser calls a paired local companion service on `127.0.0.1`.

### Types

All business types in `src/types/studio.ts`: `Conversation`, `Message`, `ImageAsset`, `GenerationParams`, `AppSettings`, plus union type aliases.

### Key Patterns

- **Image storage**: Metadata (`imageAssets` store) and binary data (`imageBlobs` store) are separated. `ImageAsset.blobKey` links them. `previewUrl` (`URL.createObjectURL`) is memory-only — created during hydration, stripped before persist via `toPlainImageAsset`.
- **Generation job flow**: `generationStore` manages the full lifecycle: create user + assistant messages → persist → dispatch to `ImageClient.generate` or `ImageClient.edit` based on whether reference images are attached → on success create `ImageAsset` + blob → on failure mark assistant message as `error`.
- **Conversation write queue**: A promise chain serializes conversation writes to prevent race conditions from rapid sequential operations.
- **Parameter editors**: Collapsible inline editors in ChatWorkspace using `grid-template-rows` CSS transition for animation. Scoped `<style>` is only used for this animation.
- **Analytics tracking**: A module-level singleton (`src/features/analytics/useAnalyticsTracker.ts`) holds the in-memory event queue and config. Both the `v-track` directive (click events) and business methods import the module-level `track()` directly, avoiding any Pinia dependency. `analyticsStore` wraps the singleton: it registers a flush listener so the reactive `eventCount` updates after each successful batch persist (use `storeToRefs` when exposing the count to keep reactivity intact). `track()` swallows all errors. Prompt-like payload fields are sanitized per `analyticsPromptCapture` (default `length_only`). Analytics events are device-local and excluded from backup export/restore.

### Styling

Tailwind CSS v4 via `@tailwindcss/vite` plugin (no config file). Single CSS entry `@import "tailwindcss"` in `src/style.css`. All styling via utility classes except the one scoped animation.

### API Integration

OpenAI-compatible Images API. Generation: `POST {apiBaseUrl}/generations` (JSON). Editing: `POST {apiBaseUrl}/edits` (multipart/form-data with `image[]` array). Response expects `{ data: [{ b64_json }] }`. Custom size validation: 16-3840px, multiples of 16, aspect ratio ≤ 3:1, total pixels 655,360-8,294,400.

## Roadmap

See `docs/roadmap.md` for the full roadmap. Current status:
- Phases 1-4: Done (chat UI, IndexedDB persistence, text-to-image, image editing with references)
- Phase 5: Experience enhancements — core items done
- Done: Settings refactor with batch operations (`docs/archive/settings-batch-operations-plan.md`)
- Done: Generation jobs (`src/stores/generationStore.ts`), per-conversation drafts (`src/services/conversationDrafts.ts`), mask editing (`docs/mask-editing.md`)
- Done: Local CLI Companion background service management (`start`/`stop`/`restart`/`logs`) with first-pairing wait flow; system keychain is deferred
- Done: Analytics event logging V1.0 (`docs/analytics-event-logging-plan.md`) — local-first event tracking with `analyticsStore`, `v-track` directive, prompt sanitization, and JSONL export. V1.1 (high-frequency controls) and V1.2 (tag color analytics) remain.

## Conventions

- Commit messages follow Conventional Commits (`feat:`, `fix:`, `chore:`, `refactor:`, `docs:`, `ci:`)
- UI language is Chinese
- Package manager is pnpm (specified in `package.json` `packageManager` field)
- Branch: develop on `honlnk/dev`, PR to `main`
- Deploy: GitHub Pages via GitHub Actions on push to `main`
