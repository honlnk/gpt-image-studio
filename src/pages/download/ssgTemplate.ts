/**
 * /download 路由的 SSG 模板改写（vite-ssg onBeforePageRender，Node 侧运行）。
 *
 * vite-ssg 对所有路由共用同一个 dist/index.html 模板（内含首页 SEO meta、
 * 三段 JSON-LD、内联 splash）。本函数在渲染 /download（zh）与 /en/download（en）
 * 前把模板改写为对应语言的下载页版本：
 * - <html lang>、title / description / canonical / OG / Twitter 全部按 locale 换；
 * - 注入 zh / en / x-default 三条 hreflang alternate（两语言页面互为对照）；
 * - 移除首页的三段 JSON-LD（WebApplication/FAQPage/Organization），注入下载页的
 *   SoftwareApplication + FAQPage（文案与页面可见 FAQ 一致，见 content.ts）；
 * - 剔除 splash 样式与标记（下载页是静态营销页，没有「应用加载中」阶段）。
 *
 * 每条改写都要求命中：index.html 结构变化导致匹配失败时直接抛错让构建失败，
 * 避免静默产出带首页 meta 的下载页。
 */
import {
  DOWNLOAD_URLS,
  buildDownloadFaqJsonLd,
  buildDownloadJsonLd,
  downloadMeta,
  type DownloadLocale,
} from "./content";

/** hreflang 用 BCP-47 短码：zh-CN 页声明 zh-CN，en 页声明 en。 */
const HREFLANG_CODE: Record<DownloadLocale, string> = {
  zh: "zh-CN",
  en: "en",
};

function replaceOnce(
  html: string,
  pattern: RegExp | string,
  replacement: string,
  label: string,
): string {
  const hit = typeof pattern === "string" ? html.includes(pattern) : pattern.test(html);
  if (!hit) {
    throw new Error(`[download-ssg] template rewrite failed: "${label}" not found (index.html structure may have changed)`);
  }
  // 字符串模式：replace 默认只换第一处，恰合「单次替换」语义
  return html.replace(pattern, replacement);
}

function replaceMetaContent(html: string, selector: string, content: string, label: string): string {
  // selector 例：`property="og:title"`；只替换同一标签内 content 的属性值
  return replaceOnce(
    html,
    new RegExp(`(<meta ${selector} content=")[^"]*(")`),
    `$1${content}$2`,
    label,
  );
}

export function renderDownloadTemplate(indexHTML: string, locale: DownloadLocale = "zh"): string {
  const meta = downloadMeta(locale);
  const url = DOWNLOAD_URLS[locale];

  // Windows CI 检出默认 autocrlf=true，模板会是 CRLF——统一成 LF 再匹配
  let html = indexHTML.replace(/\r\n/g, "\n");

  // ── html lang（en 页改 en；zh 页保持模板的 zh-CN）──
  if (locale === "en") {
    html = replaceOnce(html, '<html lang="zh-CN">', '<html lang="en">', "html lang");
  }

  // ── title / 基础 meta ──
  html = replaceOnce(html, /<title>[\s\S]*?<\/title>/, `<title>${meta.title}</title>`, "title");
  html = replaceMetaContent(html, 'name="title"', meta.ogTitle, "meta title");
  html = replaceMetaContent(html, 'name="description"', meta.description, "meta description");
  // 首页 keywords 是整站词表，下载页不沿用（关键词权重交给 title/description）
  html = replaceOnce(html, /[ \t]*<meta name="keywords"[^>]*\/>\n?/, "", "keywords strip");

  // ── canonical + hreflang（zh/en 两页互为 alternate，x-default 指主语言 zh）──
  const hreflangLinks = [
    `<link rel="alternate" hreflang="${HREFLANG_CODE.zh}" href="${DOWNLOAD_URLS.zh}" />`,
    `<link rel="alternate" hreflang="${HREFLANG_CODE.en}" href="${DOWNLOAD_URLS.en}" />`,
    `<link rel="alternate" hreflang="x-default" href="${DOWNLOAD_URLS.zh}" />`,
  ].join("\n    ");
  html = replaceOnce(
    html,
    '<link rel="canonical" href="https://image.honlnk.com/" />',
    `<link rel="canonical" href="${url}" />\n    ${hreflangLinks}`,
    "canonical",
  );
  html = replaceMetaContent(html, 'property="og:url"', url, "og:url");
  html = replaceMetaContent(html, 'property="og:title"', meta.ogTitle, "og:title");
  html = replaceMetaContent(html, 'property="og:description"', meta.ogDescription, "og:description");
  html = replaceMetaContent(html, 'name="twitter:url"', url, "twitter:url");
  html = replaceMetaContent(html, 'name="twitter:title"', meta.ogTitle, "twitter:title");
  html = replaceMetaContent(html, 'name="twitter:description"', meta.description, "twitter:description");

  // ── JSON-LD：移除首页三段，注入下载页两段（Organization 不需要重复）──
  html = replaceOnce(
    html,
    /[ \t]*<!-- JSON-LD: [\s\S]*?<script type="application\/ld\+json">[\s\S]*?<\/script>\n?/g,
    "",
    "homepage JSON-LD",
  );
  if (html.includes('application/ld+json')) {
    throw new Error("[download-ssg] template rewrite failed: studio JSON-LD not fully removed");
  }
  const jsonLd = [
    '    <!-- JSON-LD: SoftwareApplication (download page) -->',
    '    <script type="application/ld+json">',
    buildDownloadJsonLd(locale),
    "    </script>",
    "",
    '    <!-- JSON-LD: FAQPage (matches the visible FAQ copy) -->',
    '    <script type="application/ld+json">',
    buildDownloadFaqJsonLd(locale),
    "    </script>",
    "",
  ].join("\n");
  html = replaceOnce(html, /\n[ \t]*<!-- Splash critical styles/, `\n${jsonLd}\n    <!-- Splash critical styles`, "JSON-LD inject");

  // ── 剔除 splash（样式块 + 标记块），锚点是 index.html 里两处独有注释 ──
  // splash 标记块的后随元素在源模板里是入口 <script>，但 Vite 构建会把入口脚本
  // 提升到 <head>，届时后随元素是 </body>——两种结构都兼容；尾部空白用 \s*
  // 兜底（Windows 构建产物里 </div> 与 </body> 之间可能没有换行）。
  html = replaceOnce(html, /[ \t]*<!-- Splash critical styles[\s\S]*?<\/style>\s*/, "", "splash style");
  // 失配时带上 </body> 前的原文样本——各平台构建产物结构有差异，日志里直接可见。
  // splash 标记后可能跟着「首帧语言脚本」（i18n 首帧 splash 文案替换，锚点是其
  // HTML 注释）——下载页没有 splash，该脚本一并剔除，否则 app-splash 清理检查
  // 会命中脚本内的 querySelector 字符串误报。
  const splashMarkup = /[ \t]*<!-- Splash markup:[\s\S]*?<\/div>\s*(?:<!-- First-frame language script[\s\S]*?<\/script>\s*)?(?=<script|<\/body>)/;
  if (!splashMarkup.test(html)) {
    const bodyEnd = html.lastIndexOf("</body>");
    const sample = (bodyEnd === -1 ? html.slice(-500) : html.slice(Math.max(0, bodyEnd - 500), bodyEnd + 20))
      .replace(/\n/g, "\\n");
    throw new Error(`[download-ssg] template rewrite failed: "splash markup" not found. body tail sample: ${sample}`);
  }
  html = html.replace(splashMarkup, "");
  if (html.includes("app-splash")) {
    throw new Error("[download-ssg] template rewrite failed: splash markup not fully removed");
  }

  return html;
}
