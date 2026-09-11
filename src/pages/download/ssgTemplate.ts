/**
 * /download 路由的 SSG 模板改写（vite-ssg onBeforePageRender，Node 侧运行）。
 *
 * vite-ssg 对所有路由共用同一个 dist/index.html 模板（内含首页 SEO meta、
 * 三段 JSON-LD、内联 splash）。本函数在渲染 /download 前把模板改写为下载页版本：
 * - title / description / canonical / OG / Twitter 全部换成下载页内容；
 * - 移除首页的三段 JSON-LD（WebApplication/FAQPage/Organization），注入下载页的
 *   SoftwareApplication + FAQPage（文案与页面可见 FAQ 一致，见 content.ts）；
 * - 剔除 splash 样式与标记（下载页是静态营销页，没有「应用加载中」阶段）。
 *
 * 每条改写都要求命中：index.html 结构变化导致匹配失败时直接抛错让构建失败，
 * 避免静默产出带首页 meta 的下载页。
 */
import {
  DOWNLOAD_PAGE,
  buildDownloadFaqJsonLd,
  buildDownloadJsonLd,
} from "./content";

function replaceOnce(
  html: string,
  pattern: RegExp | string,
  replacement: string,
  label: string,
): string {
  const hit = typeof pattern === "string" ? html.includes(pattern) : pattern.test(html);
  if (!hit) {
    throw new Error(`[download-ssg] 模板改写失败：未命中「${label}」（index.html 结构可能已变化）`);
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

export function renderDownloadTemplate(indexHTML: string): string {
  // Windows CI 检出默认 autocrlf=true，模板会是 CRLF——统一成 LF 再匹配
  let html = indexHTML.replace(/\r\n/g, "\n");

  // ── title / 基础 meta ──
  html = replaceOnce(html, /<title>[\s\S]*?<\/title>/, `<title>${DOWNLOAD_PAGE.title}</title>`, "title");
  html = replaceMetaContent(html, 'name="title"', DOWNLOAD_PAGE.ogTitle, "meta title");
  html = replaceMetaContent(html, 'name="description"', DOWNLOAD_PAGE.description, "meta description");
  // 首页 keywords 是整站词表，下载页不沿用（关键词权重交给 title/description）
  html = replaceOnce(html, /[ \t]*<meta name="keywords"[^>]*\/>\n?/, "", "keywords strip");

  // ── canonical / OG / Twitter ──
  html = replaceOnce(html, '<link rel="canonical" href="https://image.honlnk.com/" />', `<link rel="canonical" href="${DOWNLOAD_PAGE.url}" />`, "canonical");
  html = replaceMetaContent(html, 'property="og:url"', DOWNLOAD_PAGE.url, "og:url");
  html = replaceMetaContent(html, 'property="og:title"', DOWNLOAD_PAGE.ogTitle, "og:title");
  html = replaceMetaContent(html, 'property="og:description"', DOWNLOAD_PAGE.ogDescription, "og:description");
  html = replaceMetaContent(html, 'name="twitter:url"', DOWNLOAD_PAGE.url, "twitter:url");
  html = replaceMetaContent(html, 'name="twitter:title"', DOWNLOAD_PAGE.ogTitle, "twitter:title");
  html = replaceMetaContent(html, 'name="twitter:description"', DOWNLOAD_PAGE.description, "twitter:description");

  // ── JSON-LD：移除首页三段，注入下载页两段（Organization 不需要重复）──
  html = replaceOnce(
    html,
    /[ \t]*<!-- JSON-LD: [\s\S]*?<script type="application\/ld\+json">[\s\S]*?<\/script>\n?/g,
    "",
    "homepage JSON-LD",
  );
  if (html.includes('application/ld+json')) {
    throw new Error("[download-ssg] 模板改写失败：首页 JSON-LD 未清理干净");
  }
  const jsonLd = [
    '    <!-- JSON-LD: SoftwareApplication（下载页） -->',
    '    <script type="application/ld+json">',
    buildDownloadJsonLd(),
    "    </script>",
    "",
    '    <!-- JSON-LD: FAQPage（与页面可见 FAQ 一致） -->',
    '    <script type="application/ld+json">',
    buildDownloadFaqJsonLd(),
    "    </script>",
    "",
  ].join("\n");
  html = replaceOnce(html, /\n[ \t]*<!-- 启动画面关键样式/, `\n${jsonLd}\n    <!-- 启动画面关键样式`, "JSON-LD inject");

  // ── 剔除 splash（样式块 + 标记块），锚点是 index.html 里两处独有注释 ──
  // splash 标记块的后随元素在源模板里是入口 <script>，但 Vite 构建会把入口脚本
  // 提升到 <head>，届时后随元素是 </body>——两种结构都兼容。
  html = replaceOnce(html, /[ \t]*<!-- 启动画面关键样式[\s\S]*?<\/style>\n/, "", "splash style");
  html = replaceOnce(html, /[ \t]*<!-- 启动画面：[\s\S]*?<\/div>\n(?=[ \t]*(?:<script|<\/body>))/, "", "splash markup");
  if (html.includes("app-splash")) {
    throw new Error("[download-ssg] 模板改写失败：splash 标记未剔除干净");
  }

  return html;
}
