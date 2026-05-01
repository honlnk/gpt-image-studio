# GPT Image Studio

A minimal Vue 3 + Vite helper for calling an OpenAI-compatible Images API.

## Features

- Text-to-image generation
- Image editing with optional mask
- Configurable model, base URL, size, quality, background, and output format
- Base64 preview and download
- API key stays in page memory and is not persisted

## Development

```sh
npm install
npm run dev
```

## Build

```sh
npm run build
```

## Notes

The default API base URL is `https://api.openai.com/v1/images`. Some browsers or deployments may require a backend/proxy because direct browser calls can be blocked by CORS. For production use, prefer routing requests through your own server so the API key is never exposed in the browser.
