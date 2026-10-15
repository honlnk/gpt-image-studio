# GPT Image Studio

**English** · [中文](README.md)

[![Version](https://img.shields.io/badge/version-1.1.0-brightgreen)](https://github.com/honlnk/gpt-image-studio/releases)
[![npm](https://img.shields.io/npm/v/@honlnk/image-studio-companion?label=companion%20npm)](https://www.npmjs.com/package/@honlnk/image-studio-companion)
[![Deploy](https://github.com/honlnk/gpt-image-studio/actions/workflows/deploy.yml/badge.svg)](https://github.com/honlnk/gpt-image-studio/actions/workflows/deploy.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Vue 3](https://img.shields.io/badge/Vue-3-4FC08D?logo=vuedotjs&logoColor=white)](https://vuejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-6-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-v4-06B6D4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)

> 🔗 **Try it online**: <a href="https://image.honlnk.com" target="_blank">image.honlnk.com</a>

A local-first AI image creation workbench. Generate and edit images through a chat-style UI against any OpenAI-compatible Images API. All data stays on your machine — browser storage by default, with an optional local Companion service or self-hosted server mode for credential protection and multi-user deployments. The UI is bilingual (English / 中文) and follows your system locale, defaulting to English outside Chinese locales.

## Quick Start

Pick the setup that fits you:

| Option | Best for | In one sentence |
|--------|----------|-----------------|
| **[Web app](https://image.honlnk.com)** | Quick personal use | Open in the browser, enter your own API URL and key |
| **Local Companion** | Keeping API keys out of the browser | Install a CLI service; credentials never leave your machine |
| **Docker self-hosting** | Intranet / private / multi-tenant server | One `docker compose` command brings up frontend + backend |
| **Desktop app** | Native app experience | macOS / Windows / Linux (Tauri v2) |

### Option 1: Use the web app directly

Open [image.honlnk.com](https://image.honlnk.com), enter your OpenAI-compatible Images API URL and key in Settings, and start creating. All data is stored locally in your browser.

### Option 2: Local Companion

Credentials never pass through the browser — ideal when you don't want to expose your API key to a web page:

```bash
npm install -g @honlnk/image-studio-companion
gpt-image-studio provider add    # interactively add provider credentials
gpt-image-studio start           # start the background service
gpt-image-studio status          # show the connection key (access key)
```

Then switch to "Local Companion" in the web app's settings and paste the connection key shown by `status`.

### Option 3: Docker self-hosting

```bash
# Pull prebuilt images and start (frontend only by default)
docker compose pull
docker compose up -d
# → http://localhost:8080

# With the Companion backend (local mode)
docker compose --profile companion up -d

# Server mode (JWT multi-tenant, for qiankun embedding)
JWT_SECRET=xxx ADMIN_API_KEY=xxx docker compose --profile companion-server up -d
```

Images are published to both ghcr.io and Docker Hub:

| Image | Address |
|-------|---------|
| Web frontend | `ghcr.io/honlnk/gpt-image-studio-web:latest` / `honlnk/gpt-image-studio-web:latest` |
| Companion | `ghcr.io/honlnk/gpt-image-studio-companion:latest` / `honlnk/gpt-image-studio-companion:latest` |

See the [deployment guide](docs/guides/deployment-guide.md) for details.

### Option 4: Desktop app

Download an installer (with per-platform instructions): **[image.honlnk.com/en/download/](https://image.honlnk.com/en/download/)**

**macOS (Apple Silicon) — one-line install** (terminal downloads skip Gatekeeper, zero warnings):

```bash
curl -fsSL https://raw.githubusercontent.com/honlnk/gpt-image-studio/main/scripts/install-desktop.sh | sh
```

If you download via the browser, allow the app once on first launch (the package is not signed/notarized — the normal prompt for unsigned open-source apps, see the download page for details):

- **macOS**: System Settings → Privacy & Security → click "Open Anyway"; or run `xattr -cr /Applications/GPT\ Image\ Studio.app`
- **Windows**: on the SmartScreen prompt, click "More info → Run anyway"
- **Linux**: make the AppImage executable and run it — no security prompt

Building from source (requires [Rust](docs/guides/desktop-packaging.md#前置依赖)):

```bash
pnpm dev:desktop      # dev mode
pnpm build:desktop    # build .app / .dmg (macOS)
```

See the [desktop packaging guide](docs/guides/desktop-packaging.md) for details.

## Features

**Image creation**
- Text to image: enter a prompt and generate
- Image editing: attach reference images + a prompt for partial or full edits
- Mask editing: brush, eraser, rectangle and circle tools to paint the edit region, with undo/redo
- Custom parameters: size/aspect ratio, resolution, background transparency, output format

**Prompt control**
- Prompt modes: Default, Safe, Creative, Open — Default passes your prompt through untouched
- Safe / Creative / Open inject mode instructions and wordbank inspiration before the request
- Chat history keeps your original prompt; mode wrapping only affects the text sent to the image API
- Prompt rewrite guard: optionally prepend an anti-rewrite prefix to the final request

**Conversations**
- Chat-style message stream with full creation history
- Multi-conversation management: create, search, switch, rename, delete
- Each conversation keeps its own draft and parameter settings
- Retry on generation failure

**Image library**
- Browse all generated and imported images
- Large preview with zoom
- Multi-select batch download (ZIP) and batch delete
- Storage usage visualization

**Data safety**
- Local-first: data lives in browser IndexedDB (direct mode) or the Companion backend (Companion mode)
- Full backup export/restore (ZIP)
- API keys are never written into backup files
- Companion mode keeps credentials away from the browser

## Connection Modes

| Mode | Credential storage | Best for |
|------|-------------------|----------|
| **Browser direct** | Browser local storage | Quick personal use, trusting the frontend |
| **Local Companion** | Local machine files (loopback only) | Keeping API keys out of the browser, single machine |
| **Server mode (Companion server)** | Server + JWT multi-tenancy | Shared use / private deployment / embedding into host systems |

Server mode supports JWT-authenticated per-user data isolation, qiankun micro-frontend embedding, and platform-level credential management APIs — see the [deployment guide](docs/guides/deployment-guide.md).

## Prompt Modes

Prompt modes can be switched under Settings → Prompt Protection. The Default mode never modifies your prompt; the others append mode instructions and random inspiration words before the request is sent.

| Mode | Description |
|------|-------------|
| Default | Appends nothing; keeps the current behavior |
| Safe | Safe prompt direction, drawing only from the safe wordbank |
| Creative | safe + creative wordbanks, emphasizing atmosphere and visual tension |
| Open | safe + creative + adultInspiration wordbanks, for models/providers that support adult content |

Prompt modes never rewrite your original input in the chat history — they only change the request text sent to the image API. What can actually be generated still depends on the capabilities and limits of your model and provider.

## Embedding

Two ways to embed the full workbench into your own system:

### iframe embedding

Pre-fill browser-direct configuration and default generation parameters via URL query:

```html
<iframe
  src="https://image.honlnk.com?settings=%7B%22apiUrl%22%3A%22https%3A%2F%2Fapi.example.com%22%2C%22apiKey%22%3A%22sk-xxx%22%7D"
  allow="clipboard-read; clipboard-write"
></iframe>
```

Plain query parameters (`?apiUrl=...&apiKey=...&prompt=...`) are also supported — see the table below.

### qiankun micro-frontend

For deep integration with a host system (host issues JWTs, manages users and platform credentials):

```ts
// Host side
registerMicroApps([{
  name: 'gpt-image-studio',
  entry: 'https://image.honlnk.com',
  container: '#container',
  activeRule: '/image-studio',
  props: {
    companionUrl: 'https://companion.your-domain.com',
    jwt: getCurrentUserJwt(),  // issued by the host
  },
}])
```

Full embedding examples (including a host admin page) live in `examples/`; deployment details are in the [deployment guide](docs/guides/deployment-guide.md).

### Embedding parameters (iframe)

| Parameter | Description |
|-----------|-------------|
| `settings` | URL-encoded JSON that may contain any of the parameters below |
| `apiUrl` / `apiBaseUrl` | API base URL |
| `apiKey` | API key |
| `apiBaseUrlMode=full` | Treat `apiUrl` as a complete URL; don't auto-append `/v1/images` |
| `apiMode` | API mode: `images` / `responses` |
| `streamImages` | Enable streaming previews: `1`/`0`, `true`/`false` |
| `streamPartialImages` | Number of intermediate images: `0`-`3` |
| `prompt` | Pre-fill the composer (not auto-submitted) |
| `size` | Size: `auto`, `1:1`, `16:9`, `9:16`, `custom` |
| `resolution` | Resolution: `1k`, `2k`, `4k` |
| `width` / `height` | Custom dimensions (with `size=custom`) |
| `background` | Background: `auto`, `opaque`, `transparent` |
| `outputFormat` | Output format: `png`, `webp`, `jpeg` |
| `promptRewriteGuard` | Enable the prompt rewrite guard: `1`/`0` |
| `promptRewriteGuardText` | Custom anti-rewrite prefix |

The page saves recognized settings and strips them from the URL. The current release is pinned to `gpt-image-2`; the model is not customizable via URL.

## Tech Stack

- Vue 3 (Composition API, `<script setup>`)
- TypeScript 6
- Pinia state management
- Tailwind CSS v4
- Vite
- IndexedDB persistence (direct mode) / SQLite + OSS (Companion mode)
- pnpm workspace monorepo
- Companion: Fastify + Commander (Node ≥ 20)

## Development

```bash
pnpm install
pnpm dev              # Web app (http://127.0.0.1:8888)
pnpm dev:companion    # Companion (http://127.0.0.1:19750)
pnpm test             # full test suite
pnpm typecheck        # type checking
pnpm build            # production build → dist/
```

Desktop development (requires [Rust](docs/guides/desktop-packaging.md#前置依赖)):

```bash
pnpm dev:desktop      # webview + hot reload
pnpm build:desktop    # .app / .dmg (macOS)
```

## Project Structure

```
gpt-image-studio/
├── src/                    # Web app source
├── companion/              # CLI Companion (Fastify + Commander)
├── desktop/                # Tauri v2 desktop shell
├── examples/               # Embedding examples (iframe / qiankun)
├── docs/                   # Project docs
└── .github/workflows/      # CI (Pages deploy + npm/Docker publishing)
```

## Documentation

- [Architecture](docs/architecture/architecture.md) (Chinese)
- [Deployment guide](docs/guides/deployment-guide.md) (Chinese) — Docker, server mode, nginx, qiankun embedding
- [Release guide](docs/guides/release-guide.md) (Chinese) — tag-driven npm & Docker publishing
- [Product roadmap](docs/plans/roadmap.md) (Chinese)
- [Desktop packaging](docs/guides/desktop-packaging.md) (Chinese)
- [Local Companion design](docs/companion/companion.md) (Chinese)
- [Mask editing](docs/architecture/mask-editing.md) (Chinese)
- [Prompt modes](docs/plans/prompt-modes.md) (Chinese)
- [Backup format](docs/architecture/backup-format.md) (Chinese)
- [Docs index](docs/README.md)

## Releases

This project publishes via git-tag-driven automation (see the [release guide](docs/guides/release-guide.md)):

```bash
# bump companion/package.json version → commit → tag → push
git tag companion-v1.1.0
git push origin companion-v1.1.0
# CI then runs: npm publish + Docker image build & push (ghcr.io + Docker Hub)
```

## Notes

- In browser direct mode, some APIs may be blocked by CORS — use a CORS-friendly proxy or switch to Companion mode.
- API keys are stored in the browser's local IndexedDB (direct mode); best for personal devices.
- In server mode, keep `JWT_SECRET` and `ADMIN_API_KEY` safe.

## License

[MIT](LICENSE)
