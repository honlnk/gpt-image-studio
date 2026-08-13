# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm dev                  # Start Vite dev server (127.0.0.1:8888)
pnpm dev:companion        # Start Companion CLI server (127.0.0.1:19750)
pnpm dev:desktop          # Start Tauri dev shell (webview + hot reload; needs Rust)
pnpm build:desktop        # Build desktop app to .app/.dmg (needs Rust)
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

See `docs/README.md` for the maintained documentation map and `docs/architecture/architecture.md` for the current architecture direction.

### State Management

Pinia stores in `src/stores/` manage cross-component shared state by domain (`settingsStore`, `composerStore`, `imagesStore`, `conversationsStore`, `generationStore`, `feedbackStore`, `analyticsStore`, `companionStore`).

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

All IndexedDB access goes through the `StudioStorage` abstraction (`src/services/storage/`, with `IndexedDbStorage` as the browser implementation and `CompanionStorage` for the companion-backed mode; `resolveStorage.ts` picks the implementation based on `connectionMode`). Domain services are factory-created from a shared storage instance.

| File | Purpose |
|------|---------|
| `conversations.ts` | List/save/delete conversations |
| `messages.ts` | List/save/delete messages |
| `imageAssets.ts` | Image metadata + blob CRUD (separate stores) |
| `settings.ts` | Single-record app settings + config services |
| `imagesApi/` | Browser direct image generation/editing calls, including Images API and Responses API streaming paths (barrel entry `imagesApi/index.ts`) |
| `companionApi.ts` | Browser-to-Companion health check and auth-status calls |
| `conversationDrafts.ts` | Per-conversation draft persistence (IndexedDB via StudioStorage) |
| `generationParams.ts` | Generation parameter validation and defaults |
| `promptBuilder.ts` | Prompt mode wrapping before requests while preserving raw chat prompt text |
| `favoritePrompts.ts` | Favorite prompt persistence |
| `promptWordbanks.ts` | Prompt mode wordbank helpers |
| `imageMetadata.ts` | Read image dimensions via `createImageBitmap` / `HTMLImageElement` |
| `storageUsage.ts` | Estimate IndexedDB usage via `navigator.storage.estimate()` |
| `backups.ts` | Full project export/import as ZIP |
| `analyticsEvents.ts` | Local analytics event persistence |
| `analyticsExport.ts` | Analytics ZIP/JSONL/Markdown export |
| `analyticsAnalysis.ts` | Analytics V2 read-only analysis: generation funnel, satisfaction proxy, prompt-mode comparison, time series, event distribution (pure functions) |
| `zipArchive.ts` | Hand-written ZIP file creator (CRC32 + binary format) |

### Companion Provider Layer

`companion/src/providers/` contains provider adapters behind a registry. Current adapters include OpenAI-compatible, GLM, Doubao/Volcano Ark Seedream, Qwen-Image, Wan, Grok, Gemini, Gemini-OpenAI, and DeepInfra providers. Local mode listens on `127.0.0.1` with persistent connection key auth; server mode (`--deployment-mode server`) may listen on `0.0.0.0` and uses JWT auth.

### Generation / Image Client

`src/features/generation/imageClients/imageClient.ts` defines the `ImageClient` interface (`generate` + `edit`). Two implementations:
- `directImagesClient` — browser calls user-configured OpenAI-compatible Images API directly.
- `localCompanionImagesClient` — browser calls a paired local companion service on `127.0.0.1`.

### Types

All business types in `src/types/studio.ts`: `Conversation`, `Message`, `ImageAsset`, `GenerationParams`, `AppSettings`, plus union type aliases.

### Key Patterns

- **Image storage**: Metadata (`imageAssets` store) and binary data (`imageBlobs` store) are separated. `ImageAsset.blobKey` links them. `previewUrl` (`URL.createObjectURL`) is memory-only — created during hydration, stripped before persist via `toPlainImageAsset`.
- **Generation job flow**: `generationStore` manages the full lifecycle: create user + assistant messages → persist → dispatch to `ImageClient.generate` or `ImageClient.edit` based on whether reference images are attached → on success create `ImageAsset` + blob → on generation failure mark assistant message as `error`. Image-persistence failure (blob/asset save) is handled separately via `onStorageError` and does NOT mark the job as failed (the image is already visible in memory).
- **Conversation write queue**: A promise chain serializes conversation writes to prevent race conditions from rapid sequential operations.
- **Parameter editors**: Collapsible inline editors in ChatWorkspace using `grid-template-rows` CSS transition for animation. Scoped `<style>` is only used for this animation.
- **Analytics tracking**: A module-level singleton (`src/features/analytics/useAnalyticsTracker.ts`) holds the in-memory event queue and config. Both the `v-track` directive (click events) and business methods import the module-level `track()` directly, avoiding any Pinia dependency. `analyticsStore` wraps the singleton: it registers a flush listener so the reactive `eventCount` updates after each successful batch persist (use `storeToRefs` when exposing the count to keep reactivity intact). `track()` swallows all errors. Prompt-like payload fields are sanitized per `analyticsPromptCapture` (default `length_only`). Analytics events are device-local and excluded from backup export/restore. Export produces a ZIP (`src/services/analyticsExport.ts`): `manifest.json` + `events/raw/events.jsonl` + `reports/summary.md` (incl. color-tagging section) + `reports/timeline/*.md` (7-day window / 1000 events / 2 MB shards) + `reports/conversations/*.md` (per-conversation shards). Note: `library.sort_changed` / `library.search_used` fire from the batch-operations panel (the actual home of those controls), not `ImageLibrary.vue`. Color-tag events (`image.tag_color_set` / `_changed` / `_cleared`) are instrumented at the single convergence point `imagesStore.setImageTagColor`, classifying set/changed/cleared by comparing previous vs next color. V2 analysis layer (`analyticsAnalysis.ts`) is pure-function aggregation over V1 events, surfaced via the read-only `AnalyticsDashboard.vue` (settings → 数据分析 tab); open the tab to trigger `analyticsStore.refreshAnalyticsInsights`.

### Styling

Tailwind CSS v4 via `@tailwindcss/vite` plugin (no config file). Single CSS entry `@import "tailwindcss"` in `src/style.css`. All styling via utility classes except the one scoped animation.

### API Integration

OpenAI-compatible Images API. Generation: `POST {apiBaseUrl}/generations` (JSON). Editing: `POST {apiBaseUrl}/edits` (multipart/form-data with `image[]` array). Response expects `{ data: [{ b64_json }] }`. Custom size validation: 16-3840px, multiples of 16, aspect ratio ≤ 3:1, total pixels 655,360-8,294,400.

## Roadmap

See `docs/plans/roadmap.md` for the full roadmap. Current status:
- Phases 1-4: Done (chat UI, IndexedDB persistence, text-to-image, image editing with references)
- Phase 5: Experience enhancements — core items done
- Done: Settings refactor with batch operations (`docs/archive/settings-batch-operations-plan.md`)
- Done: Generation jobs (`src/stores/generationStore.ts`), per-conversation drafts (`src/services/conversationDrafts.ts`), mask editing (`docs/architecture/mask-editing.md`)
- Done: Local CLI Companion background service management (`start`/`stop`/`restart`/`logs`) with persistent connection key auth (`status`/`reset-key`); system keychain is deferred
- Done: Analytics event logging V1.0 + V1.1 + V1.2 (`docs/plans/analytics-event-logging-plan.md`) — local-first event tracking with `analyticsStore`, `v-track` directive, prompt sanitization. V1.0 core events + V1.1 high-frequency controls (attachments, mask apply, library filter/sort/search, batch ops, settings tabs) + V1.2 color-tag analytics (`image.tag_color_set`/`_changed`/`_cleared` at the store convergence point, `library.filter_by_tag_color`). ZIP export with Markdown timeline sharding, conversation-level shards, and a color-tagging summary section. Analytics V1 complete.
- Done: Prompt modes (`docs/plans/prompt-modes.md`) — four `PromptMode` values (default/safe/creative/adult); `src/services/promptBuilder.ts` injects mode instructions + wordbank inspiration before the rewrite guard; wordbanks live in `src/services/promptWordbanks.ts`; only the request prompt is wrapped, the stored message keeps the user's original.
- Done: Responses API + streaming partial-image preview (`docs/plans/responses-streaming-plan.md`) — `apiMode` switches the direct client between Images API and Responses API; when `streamImages` is on, SSE partial images surface in `PendingGenerationCard` via a runtime-only state (not persisted); companion mode stays Images-API-only.
- Done: Desktop packaging v1 (Tauri v2) (`docs/guides/desktop-packaging.md`) — `desktop/src-tauri` embeds the existing `dist/` unchanged; `pnpm dev:desktop` / `pnpm build:desktop`; companion stays external (reached over 127.0.0.1); macOS arm64 produces a ~3 MB `.app` / ~2 MB `.dmg`. Code signing, cross-platform, and bundling the companion as a sidecar are deferred.
- Done: Analytics V2 analysis layer (`src/services/analyticsAnalysis.ts`, `src/components/settings/AnalyticsDashboard.vue`) — pure-function aggregation (generation funnel, satisfaction proxy, prompt-mode comparison, time series, event distribution) + read-only dashboard in settings → 数据分析 tab; supplemented `generation.requested` payload with promptMode/quality/format/background/resolution.
- Done: Finer image-library filters (`src/components/studio/ImageLibrary.vue`) — search, source filter (generated/edited/imported via `classifyImageSource` in `imageLibraryFormatters.ts`), format filter, sort (time/name/size + asc/desc); client-side filter with "partial load" hint for paginated "all" scope.
- Done: Error feedback polish — `feedbackStore` adds info/warning variants; `renameImage`/`setImageTagColor`/`deleteImage` rollback on persist failure and return boolean; `generationStore` separates image-save failure from generation failure; `reportStorageError` adds throttled toast; `settingsModal.images` filters transient masks from batch operations.

## Conventions

- Commit messages follow Conventional Commits (`feat:`, `fix:`, `chore:`, `refactor:`, `docs:`, `ci:`)
- UI language is Chinese
- Package manager is pnpm (specified in `package.json` `packageManager` field)
- Branch: develop on `honlnk/dev`, PR to `main`
- Deploy: GitHub Pages via GitHub Actions on push to `main`
