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

Vue 3 app split into focused studio components under `src/components/studio`, with shared state in `src/composables/useStudioState.ts`. No router or state management library.

**Layout**: Three-column ChatGPT-style UI — dark sidebar (conversations), center chat area with inline parameter editors, right panel (image library).

**State**: Pure Composition API (`ref`/`computed`/`watch`). Conversations, messages, image metadata/blobs, and settings persist through IndexedDB.

**Styling**: Tailwind CSS v4 (no config file needed, integrated via `@tailwindcss/vite`). Scoped `<style>` only for the editor collapse animation (`grid-template-rows` transition).

## Roadmap

See `docs/development-plan.md` for the full plan. Key upcoming phases:
- Phase 2: IndexedDB persistence (conversations, messages, image blobs) — done
- Phase 3: Wire up real image generation API — done
- Phase 4: Image editing flow with reference images — in progress
- Phase 5: Desktop packaging (Tauri/Electron)

## Conventions

- Commit messages follow Conventional Commits (`feat:`, `fix:`, `chore:`, `refactor:`, `docs:`, `ci:`)
- UI language is Chinese
- Package manager is pnpm (specified in `package.json` `packageManager` field)
- Branch: develop on `honlnk/dev`, PR to `main`
- Deploy: GitHub Pages via GitHub Actions on push to `main`
