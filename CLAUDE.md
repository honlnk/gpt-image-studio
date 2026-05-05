# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm dev          # Start Vite dev server
pnpm build        # Production build to dist/
pnpm preview      # Preview production build
pnpm typecheck    # Type-check with vue-tsc --noEmit
```

No linter, formatter, or test framework is configured.

## Architecture

Local-first AI image creation workbench. Vue 3 + Composition API (`<script setup>`), no router or state management library. Zero runtime dependencies beyond Vue — ZIP creation/reading, base64 conversion, image dimension reading, and storage usage estimation are all hand-written.

### State Management

Single composable `src/composables/useStudioState.ts` (~960 lines) holds all app state and business logic. `App.vue` calls it once and distributes state/methods to children via props and events (Props Down, Events Up). No Pinia/Vuex.

**Hydration**: On mount, `useStudioState` loads all data from IndexedDB into memory refs. All subsequent mutations happen in memory first, then async-persist to IndexedDB via the `services/` layer.

**Dual storage**: Lightweight drafts (`composerText`, `attachedImages`, API config) go to localStorage. Everything else (conversations, messages, image assets, image blobs, settings) goes to IndexedDB.

### Data Flow

```
User action → Component emit → App.vue handler → useStudioState method
  → mutate ref (reactive UI update) → async persist to services/ → IndexedDB
```

### Component Tree

```
App.vue
├── ConversationSidebar.vue   # Left: conversation list, search, create/delete
├── ChatWorkspace.vue         # Center: message stream + parameter editors + input
├── ImageLibrary.vue          # Right: image grid, multi-select, ZIP download, storage usage
├── SettingsModal.vue         # Teleport modal: API config + backup/restore
├── ImagePreviewModal.vue     # Teleport modal: full-screen zoom preview
└── Tooltip.vue               # Generic CSS-only tooltip
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
| `imageMetadata.ts` | Read image dimensions via `createImageBitmap` / `HTMLImageElement` |
| `storageUsage.ts` | Estimate IndexedDB usage via `navigator.storage.estimate()` |
| `backups.ts` | Full project export/import as ZIP |
| `zipArchive.ts` | Hand-written ZIP file creator (CRC32 + binary format) |

### Types

All business types in `src/types/studio.ts`: `Conversation`, `Message`, `ImageAsset`, `GenerationParams`, `AppSettings`, plus union type aliases.

### Key Patterns

- **Image storage**: Metadata (`imageAssets` store) and binary data (`imageBlobs` store) are separated. `ImageAsset.blobKey` links them. `previewUrl` (`URL.createObjectURL`) is memory-only — created during hydration, stripped before persist via `toPlainImageAsset`.
- **Message submit flow**: `submitMessage()` → create user + assistant messages → persist → `runImageRequest()` → call `generateImage` or `editImage` based on whether reference images are attached → on success create `ImageAsset` + blob → on failure mark assistant message as `error`.
- **Conversation write queue**: A promise chain serializes conversation writes to prevent race conditions from rapid sequential operations.
- **Parameter editors**: Collapsible inline editors in ChatWorkspace using `grid-template-rows` CSS transition for animation. Scoped `<style>` is only used for this animation.

### Styling

Tailwind CSS v4 via `@tailwindcss/vite` plugin (no config file). Single CSS entry `@import "tailwindcss"` in `src/style.css`. All styling via utility classes except the one scoped animation.

### API Integration

OpenAI-compatible Images API. Generation: `POST {apiBaseUrl}/generations` (JSON). Editing: `POST {apiBaseUrl}/edits` (multipart/form-data with `image[]` array). Response expects `{ data: [{ b64_json }] }`. Custom size validation: 16-3840px, multiples of 16, aspect ratio ≤ 3:1, total pixels 655,360-8,294,400.

## Roadmap

See `docs/product-roadmap.md` for the full roadmap. Current status:
- Phases 1-4: Done (chat UI, IndexedDB persistence, text-to-image, image editing with references)
- Phase 5: Experience enhancements — core items done
- Upcoming: Settings refactor with batch operations (`docs/settings-batch-operations-plan.md`), desktop packaging evaluation

## Conventions

- Commit messages follow Conventional Commits (`feat:`, `fix:`, `chore:`, `refactor:`, `docs:`, `ci:`)
- UI language is Chinese
- Package manager is pnpm (specified in `package.json` `packageManager` field)
- Branch: develop on `honlnk/dev`, PR to `main`
- Deploy: GitHub Pages via GitHub Actions on push to `main`
