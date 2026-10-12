/**
 * 下载页的文案与 SEO 内容单一来源（双语：zh /download 与 en /en/download）。
 *
 * 同一份数据喂给两个消费者，保证「页面可见内容」与「给爬虫的结构化数据」一致：
 * - DownloadPage.vue（页面 UI：FAQ 手风琴、语言互链）；
 * - ssgTemplate.ts（vite-ssg onBeforePageRender 的 meta/JSON-LD 改写）。
 *
 * 注意：本文件被 vite.config.ts（Node 侧）import，必须保持无浏览器依赖的纯数据——
 * 直接 import 两个 locale 模块取数据，不走 t()/i18n 实例。
 */
import zhDownload, { faqs as zhFaqs } from "../../locales/zh-CN/download";
import enDownload, { faqs as enFaqs } from "../../locales/en-US/download";

/** 下载页语言：zh 对应 /download，en 对应 /en/download。 */
export type DownloadLocale = "zh" | "en";

/** 站内路由（无尾斜杠；GH Pages 对目录 URL 自动重定向到尾斜杠形式）。 */
export const DOWNLOAD_ROUTES: Record<DownloadLocale, string> = {
  zh: "/download",
  en: "/en/download",
};

/** canonical/OG 用带尾斜杠的最终 URL（GH Pages 对无斜杠目录 URL 返回 301）。 */
export const DOWNLOAD_URLS: Record<DownloadLocale, string> = {
  zh: "https://image.honlnk.com/download/",
  en: "https://image.honlnk.com/en/download/",
};

/** SEO meta 形状（与两个 locale 词库的 download.meta 一致）。 */
type DownloadMeta = {
  title: string;
  description: string;
  ogTitle: string;
  ogDescription: string;
};

/**
 * 路由路径 → 页面语言；非下载页路由返回 null。
 * 容忍尾斜杠（站内互链与 GH Pages 的目录 URL 都用带尾斜杠形式）。
 */
export function downloadLocaleFromRoute(route: string): DownloadLocale | null {
  const normalized = route.replace(/\/+$/, "") || "/";
  if (normalized === DOWNLOAD_ROUTES.en) return "en";
  if (normalized === DOWNLOAD_ROUTES.zh) return "zh";
  return null;
}

/** SEO meta（title/description 与页面内容同语言）。 */
export function downloadMeta(locale: DownloadLocale): DownloadMeta {
  return locale === "en" ? enDownload.meta : zhDownload.meta;
}

/** FAQ 条目（页面手风琴与 JSON-LD FAQPage 共用，两者必须一致）。 */
export function downloadFaqs(
  locale: DownloadLocale,
): ReadonlyArray<{ question: string; answer: string }> {
  return locale === "en" ? enFaqs : zhFaqs;
}

/** JSON-LD SoftwareApplication（下载页专用，替代首页的 WebApplication 块）。 */
export function buildDownloadJsonLd(locale: DownloadLocale): string {
  return JSON.stringify(
    {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: "GPT Image Studio",
      applicationCategory: "DesignApplication",
      operatingSystem: "macOS, Windows, Linux",
      url: DOWNLOAD_URLS[locale],
      downloadUrl: DOWNLOAD_URLS[locale],
      description: downloadMeta(locale).description,
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      author: {
        "@type": "Organization",
        name: "honlnk",
        url: "https://github.com/honlnk",
      },
    },
    null,
    2,
  );
}

/** JSON-LD FAQPage（内容与页面 FAQ 一致）。 */
export function buildDownloadFaqJsonLd(locale: DownloadLocale): string {
  return JSON.stringify(
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: downloadFaqs(locale).map((faq) => ({
        "@type": "Question",
        name: faq.question,
        acceptedAnswer: { "@type": "Answer", text: faq.answer },
      })),
    },
    null,
    2,
  );
}
